import { kitFlow } from "../kits";
import type { JsonValue } from "../nodes";
import { renderCommand, runFields } from "../template";

/**
 * The command of a kit's Command node, as a step renders it: with these
 * outputs of earlier steps and these inputs as environment variables. A
 * test runs it with `env`, never with a command it changed by hand. An input
 * the test leaves out has the kit's default.
 */
export function kitCommand(
	kit: string,
	nodeId: string,
	nodes: Record<string, Record<string, JsonValue>> = {},
	inputs: Record<string, string> = {},
): { command: string; env: Record<string, string> } {
	const flow = kitFlow(kit);
	const node = flow?.nodes.find((one) => one.id === nodeId);
	if (node?.type !== "command") {
		throw new Error(`${kit} has no Command node ${nodeId}.`);
	}
	return renderCommand(node.command, {
		nodes,
		inputs: {
			...Object.fromEntries(
				(flow?.inputs ?? []).map((input) => [input.name, input.default ?? ""]),
			),
			...inputs,
		},
		run: Object.fromEntries(runFields.map((field) => [field, ""])) as Record<
			(typeof runFields)[number],
			string
		>,
	});
}
