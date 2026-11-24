/**
 * The tasks of the suggestions for a node's data: its output schema, its
 * variable writes, and the arguments of a tool call.
 */
import { nodeOutcomes, typedOutput } from "@nightshift/flows";
import { dataReaders } from "./flow-text";
import { json, type KindPrompt, quoted } from "./kind";

export const outputKind: KindPrompt = {
	what: "an output schema",
	task: ({ flow, node }) => {
		const field = typedOutput(node)?.field ?? "data";
		const readers = dataReaders(flow, node.id, field);
		const current = (node as { output?: unknown }).output;
		return [
			`Write the node's output schema: a JSON Schema for an object (\`"type": "object"\`, \`properties\`, \`required\`). The step's \`${field}\` must match it, and the rest of the flow reads it as \`{{${node.id}.${field}.<field>}}\`.`,
			"",
			"Rules:",
			"- Keep the fields the rest of the flow reads (below), with a type that fits how they are read.",
			node.type === "command"
				? "- Add the fields the command writes to `$NS_OUTPUT`, or prints as JSON."
				: node.type === "tool"
					? "- Add the fields the tool answers with."
					: node.type === "web-request"
						? "- Add the fields of the JSON body the server answers with."
						: "- Add the fields the node's prompt asks the agent to report.",
			"- Give each property a short `description`. Prefer simple types: string, number, boolean, arrays and objects of those.",
			"- Keep it small: only fields someone reads or the person asked for.",
			"",
			readers.length > 0
				? [
						"What the rest of the flow reads from this node's data:",
						...readers.map(
							(r) => `- \`${r.key}\`: read by ${r.readers.join(", ")}`,
						),
					].join("\n")
				: "No other node reads this node's data yet.",
			"",
			current
				? `The current output schema:\n${json(current)}`
				: "The node has no output schema yet.",
		];
	},
};

export const setKind: KindPrompt = {
	what: "variable writes",
	task: ({ flow, node }) => [
		"Write the node's variable writes (`set`): what this step stores in the flow's variables when it ends, so later steps can read it as `{{vars.<name>}}`.",
		"",
		"Each write: `{ variable, value?, expression?, on? }`, with exactly one of `value` and `expression`:",
		`- \`value\`: a template, for example \`{{${node.id}.summary}}\`. One reference alone keeps its JSON value.`,
		"- `expression`: a JSONata expression over the run's values, `vars` included, for example `vars.tries + 1`.",
		`- \`on\`: the outcomes that write, from ${quoted(nodeOutcomes(node))}. Leave it out to write on every outcome.`,
		"",
		"Rules:",
		"- `set` replaces the node's writes: keep the current ones that still make sense.",
		"- Use only references listed above.",
		'- Put each variable a write needs that the flow does not declare yet in `variables`: `{ name, type: "text" | "number" | "boolean" | "json", description?, initial? }`. Leave out the ones the flow declares.',
		"",
		node.set && node.set.length > 0
			? `The current writes:\n${json(node.set)}`
			: "The node writes no variables yet.",
		"",
		(flow.variables ?? []).length > 0
			? `The flow's variables:\n${json(flow.variables)}`
			: "The flow declares no variables yet.",
	],
};

export const argumentsKind: KindPrompt = {
	what: "the arguments of a tool call",
	task: ({ request, node }) => {
		const tool = node.type === "tool" ? node : null;
		return [
			`Write the arguments of the call to the tool \`${tool?.tool ?? ""}\` of the MCP server \`${tool?.connection ?? ""}\`. \`arguments\` maps each argument's name to a template.`,
			"",
			"Rules:",
			"- Fill every required argument. Add an optional one only when the flow has a value for it.",
			"- Use the names of the tool's input schema exactly. Do not invent arguments.",
			"- A template that is one reference keeps its JSON value: `{{plan.data.tasks}}` stays a list. Other text is a string, read as the type the schema says.",
			"- Use only references listed above. Plain text is fine for a fixed value.",
			"",
			request.toolSchema
				? `The tool's input schema:\n${json(request.toolSchema)}`
				: "The tool's input schema is not known: keep the current argument names, and add one only when the instruction names it.",
			"",
			tool && Object.keys(tool.arguments).length > 0
				? `The current arguments:\n${json(tool.arguments)}`
				: "The node has no arguments yet.",
		];
	},
};
