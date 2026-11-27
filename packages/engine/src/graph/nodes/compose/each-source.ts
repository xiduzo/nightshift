import {
	type CallEachNode,
	type ListItem,
	renderCommand,
	type TemplateContext,
} from "@nightshift/flows";
import { runCommand } from "../../../device";
import type { StepContext } from "../../context";
import { jsonSourceItems, parseCommandItems } from "../../data";
import type { StepHandle } from "../../step";

/**
 * Reads the source as list items: a JSON value, or the JSON a command
 * prints in the worktree. Throws with a readable
 * message. Ported from `readSource` in engine.ts.
 */
export async function readSource(
	ctx: StepContext,
	node: CallEachNode,
	tctx: TemplateContext,
	step: StepHandle,
): Promise<ListItem[]> {
	const worktree = step.worktree;
	const source = node.each.source;
	switch (source.kind) {
		case "json":
			return jsonSourceItems(source.value, tctx);
		case "command": {
			const { command, env } = renderCommand(source.command, tctx);
			let stdout = "";
			const result = await runCommand(step.device, {
				command,
				cwd: worktree,
				env,
				logPath: ctx.log.files(ctx.run.id).commandLog(step.stepId),
				signal: step.signal,
				onOutput: (stream, text) => {
					if (stream === "stdout") stdout += text;
				},
			});
			if (result.spawnError) {
				throw new Error(
					`The source command could not start: ${result.spawnError}`,
				);
			}
			if (result.exitCode !== 0) {
				throw new Error(
					`The source command failed. Its last output:\n${result.logTail}`,
				);
			}
			return parseCommandItems(stdout);
		}
	}
}
