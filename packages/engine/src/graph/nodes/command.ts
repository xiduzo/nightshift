import { type CommandNode, renderCommand } from "@nightshift/flows";

import { runCommand } from "../../command";
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
 * The Command node: `sh -c` in the worktree, exit 0 is `pass`, every other
 * exit `fail`. Port of `runCommandStep` in engine.ts. Template values reach
 * the command as environment variables (`renderCommand`), never as shell
 * text. The transcript gets `command-start`, a `command-output` per chunk
 * of stdout and stderr, and `command-exit`; the output also goes to the
 * step's log file (`StepStarted.logPath`). A stop of the run or the node's
 * time budget aborts the step's signal, which kills the process group.
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

async function runShell(
	ctx: StepContext,
	node: CommandNode,
	step: StepHandle,
): Promise<StepEnd> {
	const { stepId, visit, signal } = step;
	const { command, env } = renderCommand(node.command, step.tctx);
	step.record(null, { type: "command-start", command });
	const result = await runCommand({
		command,
		cwd: ctx.run.worktreePath,
		env,
		logPath: commandLogPath(ctx.dataDir, ctx.run.id, stepId),
		signal,
		onOutput: (stream, text) =>
			step.record(null, { type: "command-output", stream, text }),
	});
	step.record(null, { type: "command-exit", exitCode: result.exitCode });

	const outputs: StepOutputs = { visit, log_tail: result.logTail };
	if (result.exitCode !== null) outputs.exit_code = result.exitCode;
	const aborted = step.abortResult(outputs);
	if (aborted) return step.end(aborted.outcome, aborted.outputs, aborted.error);
	if (result.spawnError) {
		return step.end(
			"error",
			{ ...outputs, outcome: "error" },
			`The command could not start: ${result.spawnError}`,
		);
	}
	const outcome = result.exitCode === 0 ? "pass" : "fail";
	return step.end(outcome, { ...outputs, outcome }, null);
}
