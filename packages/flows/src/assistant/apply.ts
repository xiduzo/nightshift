/**
 * What a suggestion does to a flow draft, and what it changes, for the
 * preview a person reads before they apply it. Pure: the editor applies the
 * result to its draft, and the person saves.
 */
import type { Flow, FlowNode, FlowVariableDef } from "../document";
import { setVariables, updateNode, withWrites } from "../draft";
import type { VariableWrite } from "../nodes";
import type { Suggestion, TextRange } from "./assistant";

/**
 * The prompt a `prompt` suggestion rewrites: an Agent's prompt, or the
 * prompt of a Decision or a Value node. Undefined: the node has no prompt
 * field (a Command, a Call), so it takes no prompt suggestion.
 */
export function promptOf(node: FlowNode): string | undefined {
	switch (node.type) {
		case "agent":
		case "decision":
			return node.prompt;
		case "value":
			return node.prompt ?? "";
		default:
			return undefined;
	}
}

/** `text` with `range` replaced by `replacement`. A range past the end is cut to the text. */
export function replaceRange(
	text: string,
	range: TextRange | undefined,
	replacement: string,
): string {
	if (!range) return replacement;
	const start = Math.min(range.start, range.end, text.length);
	const end = Math.min(Math.max(range.start, range.end), text.length);
	return text.slice(0, start) + replacement + text.slice(end);
}

/**
 * The flow with `suggestion` applied to node `nodeId`:
 * - `prompt`: its text replaces `selection` in the node's prompt, or the
 *   whole prompt without one;
 * - `output`: the node's output schema (an Agent or a Value node);
 * - `set`: the node's variable writes, and the variables they need that
 *   the flow does not declare yet, added after the ones it has.
 * A node that does not take the suggestion's kind, or no node by that id,
 * leaves the flow as it is.
 */
export function applySuggestion(
	flow: Flow,
	nodeId: string,
	suggestion: Suggestion,
	selection?: TextRange,
): Flow {
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (!node) return flow;
	switch (suggestion.kind) {
		case "prompt": {
			const before = promptOf(node);
			if (before === undefined) return flow;
			const prompt = replaceRange(before, selection, suggestion.text);
			return updateNode(flow, nodeId, (current) =>
				current.type === "agent" ||
				current.type === "decision" ||
				current.type === "value"
					? { ...current, prompt }
					: current,
			);
		}
		case "output":
			return updateNode(flow, nodeId, (current) =>
				current.type === "agent" || current.type === "value"
					? { ...current, output: suggestion.output }
					: current,
			);
		case "set": {
			const withSet = updateNode(flow, nodeId, (current) =>
				withWrites(current, suggestion.set),
			);
			const added = newVariables(flow, suggestion.variables);
			return added.length === 0
				? withSet
				: setVariables(withSet, [...(withSet.variables ?? []), ...added]);
		}
	}
}

/** The variables of `variables` the flow does not declare yet, each name once. */
export function newVariables(
	flow: Flow,
	variables: readonly FlowVariableDef[],
): FlowVariableDef[] {
	const known = new Set((flow.variables ?? []).map((v) => v.name));
	const added: FlowVariableDef[] = [];
	for (const variable of variables) {
		if (known.has(variable.name)) continue;
		known.add(variable.name);
		added.push(variable);
	}
	return added;
}

/** How one item of a suggestion compares with what the node has now. */
export type Change = "new" | "changed" | "removed" | "same";

/** One top-level field of an output schema, in a preview. */
export type OutputFieldChange = {
	name: string;
	/** Its type in words: `string`, `list of string`, `object`. */
	type: string;
	description?: string;
	required: boolean;
	change: Change;
};

type Schema = Record<string, unknown>;

function objectOf(value: unknown): Schema | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Schema)
		: undefined;
}

function propertiesOf(schema: Schema | undefined): [string, Schema][] {
	const properties = objectOf(schema?.properties);
	if (!properties) return [];
	return Object.entries(properties).map(([name, field]) => [
		name,
		objectOf(field) ?? {},
	]);
}

function requiredOf(schema: Schema | undefined): Set<string> {
	const required = schema?.required;
	return new Set(
		Array.isArray(required)
			? required.filter((name): name is string => typeof name === "string")
			: [],
	);
}

/** A field's type in words. A list says what it holds: `list of string`. */
export function typeWords(field: Schema): string {
	const type = Array.isArray(field.type)
		? field.type.join(" or ")
		: typeof field.type === "string"
			? field.type
			: field.enum
				? "one of a list"
				: "any";
	if (type === "array") {
		const items = objectOf(field.items);
		return items ? `list of ${typeWords(items)}` : "list";
	}
	return type;
}

/**
 * The top-level fields of `after`, each marked new, changed or the same as
 * in `before`, then the fields of `before` that `after` drops, marked
 * removed. A field changed when its schema or whether it is required
 * changed.
 */
export function outputChanges(
	before: Schema | undefined,
	after: Schema,
): OutputFieldChange[] {
	const old = new Map(propertiesOf(before));
	const oldRequired = requiredOf(before);
	const required = requiredOf(after);
	const fields = propertiesOf(after);
	const kept = new Set(fields.map(([name]) => name));
	const row = (
		name: string,
		field: Schema,
		isRequired: boolean,
		change: Change,
	): OutputFieldChange => ({
		name,
		type: typeWords(field),
		...(typeof field.description === "string"
			? { description: field.description }
			: {}),
		required: isRequired,
		change,
	});
	return [
		...fields.map(([name, field]) => {
			const previous = old.get(name);
			const change: Change =
				previous === undefined
					? "new"
					: JSON.stringify(previous) !== JSON.stringify(field) ||
							oldRequired.has(name) !== required.has(name)
						? "changed"
						: "same";
			return row(name, field, required.has(name), change);
		}),
		...[...old]
			.filter(([name]) => !kept.has(name))
			.map(([name, field]) =>
				row(name, field, oldRequired.has(name), "removed"),
			),
	];
}

/** One variable write of a `set` suggestion, in a preview. */
export type WriteChange = { write: VariableWrite; change: Change };

function sameWrite(a: VariableWrite, b: VariableWrite): boolean {
	return (
		a.value === b.value &&
		a.expression === b.expression &&
		JSON.stringify(a.on ?? []) === JSON.stringify(b.on ?? [])
	);
}

/**
 * The writes of `after`, each marked new, changed or the same as the write
 * of `before` to the same variable (in order, when a node writes one
 * variable twice), then the writes `after` drops, marked removed.
 */
export function writeChanges(
	before: readonly VariableWrite[],
	after: readonly VariableWrite[],
): WriteChange[] {
	const left = [...before];
	const rows: WriteChange[] = after.map((write) => {
		const at = left.findIndex((old) => old.variable === write.variable);
		if (at === -1) return { write, change: "new" };
		const [old] = left.splice(at, 1);
		return {
			write,
			change: old && sameWrite(old, write) ? "same" : "changed",
		};
	});
	return [
		...rows,
		...left.map((write) => ({ write, change: "removed" as const })),
	];
}
