/**
 * The tasks of the suggestions for a field of the flow, not of a node: its
 * description and its inputs.
 */
import {
	type Flow,
	type FlowNode,
	flowReads,
	hasCascade,
} from "@nightshift/flows";
import { draftSummary, nodesReading } from "./flow-text";
import { json, type KindPrompt, quoted } from "./kind";

/** A node in one line: its id, type and label, and the start of its prompt or command. */
function nodeLine(node: FlowNode): string {
	const text =
		"prompt" in node && typeof node.prompt === "string"
			? node.prompt
			: node.type === "command"
				? node.command
				: "";
	const short = text.replace(/\s+/g, " ").trim().slice(0, 160);
	return `- \`${node.id}\` (${node.type}${node.label ? `, "${node.label}"` : ""})${short ? `: ${short}` : ""}`;
}

/**
 * Names that templates of the flow read but that are no input, node, `run`
 * or `vars`. A node with a cascade reads its try as `cascade` in its own
 * templates (`{{cascade.tier}}`, ADR 6), as the check allows: no input
 * declares it.
 */
function undeclaredNames(flow: Flow): { name: string; readers: string[] }[] {
	const known = new Set([
		"run",
		"vars",
		...flow.inputs.map((input) => input.name),
		...flow.nodes.map((node) => node.id),
	]);
	const climbing = new Set(
		flow.nodes.filter(hasCascade).map((node) => node.id),
	);
	const found = new Map<string, Set<string>>();
	for (const { reader, name, rule } of flowReads(flow)) {
		if (!("node" in reader) || rule || known.has(name)) continue;
		if (name === "cascade" && climbing.has(reader.node)) continue;
		const readers = found.get(name) ?? new Set<string>();
		readers.add(reader.node);
		found.set(name, readers);
	}
	return [...found].map(([name, readers]) => ({
		name,
		readers: [...readers],
	}));
}

/** Where each input is read: the nodes whose templates or rules read it. */
function inputReaders(flow: Flow, name: string): string[] {
	return nodesReading(flow, (read) => read.name === name);
}

export const descriptionKind: KindPrompt<{ flow: Flow }> = {
	what: "a description",
	task: ({ flow }) => [
		"Write the flow's description: what it does and what it gives you, for a person who picks a flow to run. `description` is that text.",
		"",
		"Rules:",
		"- One or two plain sentences, at most 30 words. Lead with what it does.",
		"- Say what starts it or what it needs, and what you get at the end.",
		"- No node ids, no file names, no internals.",
		"- Write in the language of the current description, or of the prompts.",
		"",
		"The flow in short:",
		draftSummary(flow),
		"",
		...((flow.sections ?? []).length > 0
			? [
					"Its phases, as the editor groups the steps:",
					...(flow.sections ?? []).map(
						(section) =>
							`- ${section.label}${section.description ? `: ${section.description}` : ""}`,
					),
					"",
				]
			: []),
		"Its steps:",
		...flow.nodes.map(nodeLine),
	],
};

export const inputsKind: KindPrompt<{ flow: Flow }> = {
	what: "inputs",
	task: ({ flow }) => {
		const missing = undeclaredNames(flow);
		return [
			"Write the flow's inputs: the values a person gives when they start a run, or a calling flow passes in. `inputs` replaces the flow's inputs.",
			"",
			'Each input: `{ name, type: "text" | "number" | "boolean" | "choice" | "json", label?, description?, default?, required?, options? }`. `choice` needs `options`, a list of text. Pick the type that fits: `boolean` for yes/no, `number` for counts, `choice` for a fixed list.',
			"- `name`: lowercase letters, digits and `_`, starting with a letter. Templates read it as `{{name}}`.",
			"- `type`: `json` for a value with fields, read with a path (`{{issue.title}}`). Else `text`.",
			"- `description`: one sentence on what to give, with an example. Always give one.",
			"- `required`: true when the flow cannot work without it and there is no `default`.",
			"",
			"Rules:",
			"- Keep every input the flow reads now, with its name: a rename breaks the templates that read it.",
			"- Add the names templates read that the flow does not declare (below).",
			"- Add an input only for a value that changes from run to run. Leave out what the flow can find itself.",
			"",
			flow.inputs.length > 0
				? [
						"The current inputs, and the nodes that read each:",
						json(flow.inputs),
						...flow.inputs.map(
							(input) =>
								`- \`${input.name}\`: ${inputReaders(flow, input.name).join(", ") || "not read"}`,
						),
					].join("\n")
				: "The flow has no inputs yet.",
			"",
			missing.length > 0
				? [
						"Names templates read that the flow does not declare:",
						...missing.map(
							(m) => `- \`${m.name}\`: read by ${quoted(m.readers)}`,
						),
					].join("\n")
				: "Every name the templates read is declared.",
			"",
			"Its steps:",
			...flow.nodes.map(nodeLine),
		];
	},
};
