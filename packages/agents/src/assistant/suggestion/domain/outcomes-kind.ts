/**
 * The task of a suggestion for a node's outcomes: a Decision's options, or
 * an Agent's own outcomes. Its context is the edges that leave the node.
 */
import { type Flow, type FlowNode, nodeOutcomes } from "@nightshift/flows";
import { json, type KindPrompt, quoted } from "./kind";
import { nodesReading } from "./prompts";

/** The edges that leave `node`: each outcome and where it goes. */
function outgoing(flow: Flow, node: FlowNode): string[] {
	const edges = flow.edges.filter((edge) => edge.from === node.id);
	if (edges.length === 0) return ["No edge leaves this node yet."];
	return edges.map((edge) => {
		const to = flow.nodes.find((n) => n.id === edge.to);
		const what = to
			? `\`${to.id}\` (${to.type}${to.label ? `, "${to.label}"` : ""})`
			: `\`${edge.to}\``;
		return `- on \`${edge.outcome}\` → ${what}${edge.max ? `, at most ${edge.max} times` : ""}`;
	});
}

/** The other nodes whose templates or rules read `{{<id>.outcome}}`. */
function outcomeReaders(flow: Flow, nodeId: string): string[] {
	return nodesReading(
		flow,
		({ name, path }) => name === nodeId && path[0] === "outcome",
	).filter((id) => id !== nodeId);
}

export const outcomesKind: KindPrompt = {
	what: "outcomes",
	task: ({ flow, node }) => {
		const decision = node.type === "decision" ? node : null;
		const words = decision ? "options" : "own outcomes";
		const current = decision
			? decision.options
			: node.type === "agent"
				? node.outcomes
				: undefined;
		const readers = outcomeReaders(flow, node.id);
		const lines = [
			decision
				? `Write the Decision's options: the answers it picks from. Each option is an outcome with its own edge. ${
						decision.by === "person"
							? "A person picks one: each option is a button in their inbox."
							: decision.by === "model"
								? "A model picks one: its `description` tells the model when to pick it."
								: "A rule picks one: the first option whose `when` holds. The last option has no `when`: it is the default."
					}`
				: "Write the Agent's own outcomes: the ways its step can end. The agent reports exactly one, and each has its own edge. They replace `pass`, `fail` and `needs-input`.",
			"",
			"Each outcome: `{ name, description?, color?, from?" +
				(decision?.by === "rule" ? ", when?" : "") +
				" }`.",
			"- `name`: lowercase letters, digits and `-`, starting with a letter, at most 30 characters, such as `approved` or `changes-requested`. Not `error`, `stopped`, `interrupted` or `waiting`.",
			"- `description`: one sentence on when to pick it. Always give one.",
			"- `from`: the current outcome this one replaces, so its edge moves to the new name. Without `from`, a current outcome you leave out loses its edge.",
			...(decision?.by === "rule"
				? ["- `when`: leave it out to keep the rule of the option it replaces."]
				: []),
			...(decision
				? []
				: [
						"- Keep `fail` when the work can fail: a step that ends `fail` fails the run unless an edge catches it.",
					]),
			"",
			"Rules:",
			"- Two to four outcomes, each a different next step. Read the node's prompt: what results does it describe?",
			"- Fit the edges that leave the node now (below). Keep the outcomes that have an edge, or rename them with `from`.",
			"- Prefer names a person understands on the canvas.",
			"",
			"The node's prompt:",
			"```",
			(node as { prompt?: string }).prompt?.trim() || "(empty)",
			"```",
			"",
			`The node's current ${words}:`,
			current ? json(current) : quoted(nodeOutcomes(node)),
			"",
			"Where the flow goes next from this node:",
			...outgoing(flow, node),
			"",
			readers.length > 0
				? `These nodes read the outcome as \`{{${node.id}.outcome}}\`: ${quoted(readers)}. Keep the names they compare against.`
				: "No node reads the outcome by name.",
		];
		return lines;
	},
};
