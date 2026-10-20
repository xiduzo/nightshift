import {
	type CommandNode,
	commandExits,
	exitFor,
	type Outcome,
	renderCommand,
} from "@nightshift/flows";

import { runCommand } from "../../device";
import { commandLogPath, type StepOutputs } from "../../log";
import {
	endedAtReason,
	type NodeAction,
	type NodeKind,
	PLAIN_KIND,
	type StepContext,
} from "../context";
import { parseCommandJson } from "../each";
import { RESUME_RULES } from "../resume-point";
import { type BodyResult, runStep, type StepHandle } from "../step-runner";

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
 * Every visit is new (`RESUME_RULES.fresh`): a parked or interrupted
 * Command step has nothing to continue, so a resume starts the next visit.
 * The step lifecycle is the step runner's; this module is the body.
 */
export function commandNode(node: CommandNode, ctx: StepContext): NodeAction {
	return (state, config) =>
		runStep(ctx, node, state, config, {
			rules: COMMAND.resumeRules(node),
			body: (step) => runShell(ctx, node, step),
		});
}

/**
 * Whether `outcome` is the node's exit on code 0. A command's other exits,
 * the catch-all among them, are failures.
 */
function isSuccessExit(node: CommandNode, outcome: Outcome): boolean {
	return commandExits(node).some(
		(exit) => exit.name === outcome && exit.code === 0,
	);
}

/**
 * The Command kind. The one kind whose chosen end is not `pass` by name
 * but its exit on code 0, whatever that exit is called; every step writes
 * the command log.
 */
export const COMMAND: NodeKind<CommandNode> = {
	...PLAIN_KIND,
	type: "command",
	make: commandNode,
	works: () => "worktree",
	// A wait node: the step sleeps while its Device is offline.
	aux: () => [{ kind: "wait" }],
	resumeRules: () => RESUME_RULES.fresh,
	isChosenEnd: isSuccessExit,
	endReason: (node, outcome) =>
		isSuccessExit(node, outcome) ? null : endedAtReason(node, outcome),
	logsCommandOutput: () => true,
};

/** What the step says when the command's output is not JSON. */
export const NOT_JSON_REASON = "The command's output is not valid JSON.";

async function runShell(
	ctx: StepContext,
	node: CommandNode,
	step: StepHandle,
): Promise<BodyResult> {
	const { stepId, visit, signal } = step;
	const end = (
		outcome: string,
		outputs: StepOutputs,
		error: string | null,
	): BodyResult => ({ kind: "end", outcome, outputs, error });
	const { command, env } = renderCommand(node.command, step.tctx);
	step.record(null, { type: "command-start", command });
	const json = node.output === "json";
	let stdout = "";
	const result = await runCommand(step.device, {
		command,
		cwd: step.worktree,
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
	if (signal.aborted) return { kind: "aborted", outputs };
	// The exit a code ends on, or an error step when the node has none.
	const endOn = (code: number | null, reason: string | null) => {
		const exit = exitFor(node, code);
		if (!exit) {
			return end(
				"error",
				outputs,
				reason ??
					(code === null
						? "The command did not exit normally, and the node has no exit for other codes."
						: `The command exited with code ${code}, and the node has no exit for it.`),
			);
		}
		return end(exit.name, outputs, reason);
	};
	if (result.spawnError) {
		const reason = `The command could not start: ${result.spawnError}`;
		// A node without its own exits errors here, as it always has.
		if (node.exits === undefined) return end("error", outputs, reason);
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
