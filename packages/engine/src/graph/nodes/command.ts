import {
	type CommandNode,
	dataExitFor,
	exitFor,
	isChosenExit,
	type JsonValue,
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
 * The Command node: `sh -c` in the worktree. Its data or its exit code
 * picks the outcome: data with an `outcome` that names one of the node's
 * exits ends on that exit (`dataExitFor`), else the exit with the code,
 * else the catch-all, else the step errors (`exitFor`). A node without its
 * own exits ends `pass` on 0 and `fail` on any other code. Template values
 * reach the command as environment variables (`renderCommand`), never as
 * shell text. The transcript gets `command-start`, a `command-output` per
 * chunk of stdout and stderr, and `command-exit`; the output also goes to
 * the step's log file (`StepStarted.logPath`). A stop of the run or the
 * node's time budget aborts the step's signal, which kills the process
 * group.
 *
 * The node's `secrets` go to the Device by name: it reads their values
 * itself and hands back output with them as `•••`, so the transcript, the
 * log file, `log_tail` and `data` never hold one. A secret the Device does
 * not have errors the step before the command runs.
 *
 * The data: the Device gives the command a new, empty file named in
 * `NS_OUTPUT`. What the command wrote there is parsed as one JSON value
 * into `data` (`{{check.data.tests}}`), whatever `output` says and
 * whatever the exit code, so stdout stays a log. A file that is not JSON
 * ends the step on the catch-all. An empty file leaves the older way:
 * with `output: "json"` and exit 0, what the command printed on stdout is
 * the JSON, and output that is not JSON ends on the catch-all too.
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
 * The Command kind. The one kind whose chosen end is not `pass` by name
 * but its exit on code 0, whatever that exit is called, or an exit only
 * its data picks (`isChosenExit`); every step writes the command log.
 */
export const COMMAND: NodeKind<CommandNode> = {
	...PLAIN_KIND,
	type: "command",
	make: commandNode,
	works: () => "worktree",
	// A wait node: the step sleeps while its Device is offline.
	aux: () => [{ kind: "wait" }],
	resumeRules: () => RESUME_RULES.fresh,
	isChosenEnd: isChosenExit,
	endReason: (node, outcome) =>
		isChosenExit(node, outcome) ? null : endedAtReason(node, outcome),
	logsCommandOutput: () => true,
};

/** What the step says when the command's output is not JSON. */
const NOT_JSON_REASON = "The command's output is not valid JSON.";
/** What the step says when the data the command wrote is not JSON. */
const NOT_JSON_DATA_REASON = "The data the command wrote is not valid JSON.";

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
		...(node.secrets && node.secrets.length > 0
			? { secrets: node.secrets }
			: {}),
		outputFile: true,
		// A sync flow writes the project's knowledge: `NS_KNOWLEDGE`.
		knowledge: { projectId: ctx.run.projectId },
		logPath: commandLogPath(ctx.dataDir, ctx.run.id, stepId),
		signal,
		onOutput: (stream, text) => {
			if (json && stream === "stdout") stdout += text;
			step.record(null, { type: "command-output", stream, text });
		},
	});
	// A secret the Device does not have: the command did not run.
	if (result.refused !== null) {
		return end("error", { visit }, result.refused);
	}
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
	const written = result.output?.trim() ?? "";
	if (written !== "") {
		try {
			outputs.data = JSON.parse(written) as JsonValue;
		} catch {
			return endOn(null, NOT_JSON_DATA_REASON);
		}
	} else if (json && code === 0) {
		try {
			outputs.data = parseCommandJson(stdout, "The command");
		} catch {
			return endOn(null, NOT_JSON_REASON);
		}
	}
	const chosen = dataExitFor(node, outputs.data);
	if (chosen) return end(chosen.name, outputs, null);
	return endOn(code, null);
}
