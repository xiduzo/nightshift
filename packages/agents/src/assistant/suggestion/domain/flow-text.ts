/**
 * A flow as text for a prompt: as JSON and in a few lines, what a template
 * in a node can read, who reads a node's data, and the retry after an
 * invalid suggestion.
 */
import {
	type Flow,
	type FlowNode,
	type FlowRead,
	flowReads,
	type TemplateField,
	templateScope,
} from "@nightshift/flows";

/**
 * The flow as JSON for the agent. `canvas: false` leaves out what only the
 * canvas needs (positions, Sections): for a prompt about one field. A tool
 * that hands the agent a flow to change keeps them, else the agent's
 * proposal drops the person's Sections and layout.
 */
export function flowJson(
	flow: Flow | FlowNode,
	{ canvas = true }: { canvas?: boolean } = {},
): string {
	if (canvas) return JSON.stringify(flow, null, 2);
	return JSON.stringify(
		flow,
		(key, value) =>
			key === "position" || key === "sections" ? undefined : value,
		2,
	);
}

function fieldLine(field: TemplateField): string {
	const notes = [
		field.json ? "JSON: a path below it works" : "",
		field.description ?? "",
	].filter(Boolean);
	return `- \`{{${field.ref}}}\`${notes.length > 0 ? `: ${notes.join(". ")}` : ""}`;
}

/** Every reference a template in this flow may use, as a Markdown list. */
export function scopeList(flow: Flow, nodeId: string): string {
	const scope = templateScope(flow);
	const lines: string[] = [];
	lines.push("Flow inputs:");
	lines.push(
		...(scope.inputs.length > 0
			? scope.inputs.map(fieldLine)
			: ["- none: the flow has no inputs"]),
	);
	lines.push("", "Flow variables:");
	lines.push(
		...((scope.vars ?? []).length > 0
			? (scope.vars ?? []).map(fieldLine)
			: ["- none: the flow declares no variables"]),
	);
	lines.push("", "Outputs of the nodes (the latest step of each):");
	for (const node of scope.nodes) {
		const own =
			node.id === nodeId ? " (this node: its previous step, in a loop)" : "";
		lines.push(`- Node \`${node.id}\`${own}:`);
		for (const field of node.fields) {
			lines.push(`  ${fieldLine(field)}`);
			for (const key of field.keys ?? []) lines.push(`    ${fieldLine(key)}`);
		}
		if (node.open)
			lines.push("    - more fields: the outputs of the flow it calls");
	}
	lines.push("", "The run:", ...scope.run.map(fieldLine));
	return lines.join("\n");
}

/**
 * The nodes that read what `matches` picks in the texts they use
 * (`flowReads`), each once, in the order of the flow.
 */
export function nodesReading(
	flow: Flow,
	matches: (read: FlowRead) => boolean,
): string[] {
	const ids: string[] = [];
	for (const read of flowReads(flow)) {
		if (!("node" in read.reader) || !matches(read)) continue;
		if (!ids.includes(read.reader.node)) ids.push(read.reader.node);
	}
	return ids;
}

/**
 * The keys of `nodeId`'s `data` (or another output `field`, such as a
 * Web request's `body`) that the rest of the flow reads (`flowReads`): in
 * templates (`{{plan.data.tasks}}`), rules and expressions
 * (`plan.data.ok`), the flow's outputs, the initial values of its
 * variables, and the node's own variable writes. Each key with who reads
 * it.
 */
export function dataReaders(
	flow: Flow,
	nodeId: string,
	field = "data",
): { key: string; readers: string[] }[] {
	const found = new Map<string, Set<string>>();
	const add = (key: string, reader: string) => {
		const readers = found.get(key) ?? new Set<string>();
		readers.add(reader);
		found.set(key, readers);
	};
	const own: string[] = [];
	for (const { reader, name, path, self } of flowReads(flow)) {
		const [first, key] = path;
		if (name !== nodeId || first !== field || key === undefined) continue;
		if (!("node" in reader)) {
			add(
				key,
				"output" in reader ? "the flow's outputs" : "the flow's variables",
			);
		} else if (reader.node !== nodeId) {
			add(key, `node \`${reader.node}\``);
		} else if (self) {
			// Its own writes read its data too.
			own.push(key);
		}
	}
	for (const key of own) add(key, "this node's variable writes");
	return [...found].map(([key, readers]) => ({ key, readers: [...readers] }));
}

/** The follow-up when the answer does not pass the checks. */
export function retryPrompt(problems: readonly string[]): string {
	return [
		"Your suggestion does not pass the checks:",
		...problems.map((problem) => `- ${problem}`),
		"",
		"Fix these problems and report the whole suggestion again.",
	].join("\n");
}

/** The draft in a few lines: its steps, inputs and outputs. */
export function draftSummary(flow: Flow): string {
	const lines = [
		flow.description ? `Description: ${flow.description}` : "",
		flow.nodes.length > 0
			? `Steps: ${flow.nodes.map((node) => `\`${node.id}\` (${node.type})`).join(", ")}. Starts at \`${flow.start}\`.`
			: "No steps yet: the flow is empty.",
		flow.inputs.length > 0
			? `Inputs: ${flow.inputs.map((input) => `\`${input.name}\``).join(", ")}.`
			: "",
		flow.outputs.length > 0
			? `Outputs: ${flow.outputs.map((output) => `\`${output.name}\``).join(", ")}.`
			: "",
	];
	return lines.filter(Boolean).join("\n");
}
