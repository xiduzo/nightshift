import { kitFlow } from "../kits";
import type { JsonValue } from "../nodes";
import { renderCommand, runFields } from "../template";

/**
 * The command of a kit's Command node, as a step renders it: with these
 * outputs of earlier steps as environment variables. A test runs it with
 * `env`, never with a command it changed by hand.
 */
export function kitCommand(
	kit: string,
	nodeId: string,
	nodes: Record<string, Record<string, JsonValue>> = {},
): { command: string; env: Record<string, string> } {
	const node = kitFlow(kit)?.nodes.find((one) => one.id === nodeId);
	if (node?.type !== "command") {
		throw new Error(`${kit} has no Command node ${nodeId}.`);
	}
	return renderCommand(node.command, {
		nodes,
		inputs: {},
		run: Object.fromEntries(runFields.map((field) => [field, ""])) as Record<
			(typeof runFields)[number],
			string
		>,
	});
}
