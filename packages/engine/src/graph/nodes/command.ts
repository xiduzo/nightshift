import { type CommandNode, exitFor, renderCommand } from "@nightshift/flows";

import { runCommand } from "../../command";
import { parseCommandJson } from "../../each";
import type { StepOutputs } from "../../events";
import { commandLogPath } from "../../transcripts";
import {
	beginStep,
	messageOf,
	type NodeAction,
	type StepContext,
	type StepHandle,
} from "../context";
import { route, type StepEnd } from "../route";

/**
 * The Command node: `sh -c` in the worktree. The exit code picks the
 * outcome (`exitFor`): the exit with that code, else the catch-all, else
 * the step errors. A node without its own exits ends `pass` on 0 and
 * `fail` on any other code. Template values reach
 * the command as environment variables (`renderCommand`), never as shell
 * text. The transcript gets `command-start`, a `command-output` per chunk
 * of stdout and stderr, and `command-exit`; the output also goes to the
 * step's log file (`StepStarted.logPath`). A stop of the run or the node's
 * time budget aborts the step's signal, which kills the process group.
 *
 * With `output: "json"`, what the command printed on stdout is parsed as
 * one JSON value into `data` (`{{check.data.tests}}`); output that is not
 * JSON ends the step on the catch-all, as a command that cannot start does.
 *
 * Every visit is new: a parked or interrupted Command step has nothing to
 * continue, so a resume starts the next visit, as the engine does today.
 */
export function commandNode(node: CommandNode, ctx: StepContext): NodeAction {
	return async (state, config) => {
		const begun = await beginStep(ctx, node, state, config);
		if (begun.kind === "parked") return begun.command;
		const step = begun.step;

		let result: StepEnd;
		try {
			result = await runShell(ctx, node, step);
		} catch (error) {
			result = await step.end(
				"error",
				{ outcome: "error", visit: step.visit },
				messageOf(error),
			);
		}
		return route(ctx, state, node, result, config);
	};
}

/** What the step says when the command's output is not JSON. */
export const NOT_JSON_REASON = "The command's output is not valid JSON.";

async function runShell(
	ctx: StepContext,
	node: CommandNode,
	step: StepHandle,
): Promise<StepEnd> {
	const { stepId, visit, signal } = step;
	const { command, env } = renderCommand(node.command, step.tctx);
	step.record(null, { type: "command-start", command });
	const json = node.output === "json";
	let stdout = "";
	const result = await runCommand({
		command,
		cwd: ctx.run.worktreePath,
		env,
		logPath: commandLogPath(ctx.dataDir, ctx.run.id, stepId),
		signal,
		onOutput: (stream, text) => {
			if (json && stream === "stdout") stdout += text;
			step.record(null, { type: "command-output", stream, text });
		},
	});
	step.record(null, { type: "command-exit", exitCode: result.exitCode });

	const outputs: StepOutputs = { visit, log_tail: result.logTail };
	if (result.exitCode !== null) outputs.exit_code = result.exitCode;
	const aborted = step.abortResult(outputs);
	if (aborted) return step.end(aborted.outcome, aborted.outputs, aborted.error);
	// The exit a code ends on, or an error step when the node has none.
	const endOn = (code: number | null, reason: string | null) => {
		const exit = exitFor(node, code);
		if (!exit) {
			return step.end(
				"error",
				{ ...outputs, outcome: "error" },
				reason ??
					(code === null
						? "The command did not exit normally, and the node has no exit for other codes."
						: `The command exited with code ${code}, and the node has no exit for it.`),
			);
		}
		return step.end(exit.name, { ...outputs, outcome: exit.name }, reason);
	};
	if (result.spawnError) {
		const reason = `The command could not start: ${result.spawnError}`;
		// A node without its own exits errors here, as it always has.
		if (node.exits === undefined) {
			return step.end("error", { ...outputs, outcome: "error" }, reason);
		}
		return endOn(null, reason);
	}
	const code = result.exitCode;
	if (code !== 0) return endOn(code, null);
	if (json) {
		try {
			outputs.data = parseCommandJson(stdout, "The command");
		} catch {
			return endOn(null, NOT_JSON_REASON);
		}
	}
	return endOn(0, null);
}
