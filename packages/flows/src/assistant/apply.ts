/**
 * What a suggestion does to a flow draft, and what it changes, for the
 * preview a person reads before they apply it. Pure: the editor applies the
 * result to its draft, and the person saves.
 */
import {
	type Flow,
	type FlowInputDef,
	type FlowNode,
	type FlowVariableDef,
	nodeOutcomes,
} from "../document";
import {
	type NodeOption,
	setInputs,
	setVariables,
	updateNode,
	withOptions,
	withWrites,
} from "../draft";
import type { VariableWrite } from "../nodes";
import type {
	SuggestedOutcome,
	Suggestion,
	SuggestionKind,
	TextRange,
} from "./assistant";

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
 * Whether `node` has the field a suggestion of `kind` fills, as
 * `applySuggestion` applies it. A kind of the flow (`description`,
 * `inputs`) takes no node.
 */
export function takesSuggestion(node: FlowNode, kind: SuggestionKind): boolean {
	switch (kind) {
		case "prompt":
			return promptOf(node) !== undefined;
		case "output":
			return node.type === "agent" || node.type === "value";
		case "set":
			return true;
		case "outcomes":
			return node.type === "agent" || node.type === "decision";
		case "rules":
			return node.type === "decision" && node.by === "rule";
		case "expression":
			return node.type === "value" && node.by === "rule";
		case "command":
			return commandOf(node) !== undefined;
		case "checker":
			return node.type === "agent" && node.checker !== undefined;
		case "arguments":
			return node.type === "tool" && node.tool.trim() !== "";
		case "description":
		case "inputs":
			return false;
	}
}

/**
 * The command a `command` suggestion rewrites: a Command's, the one a Wait
 * runs until it passes, or the one that prints a Call node's list.
 */
export function commandOf(node: FlowNode): string | undefined {
	if (node.type === "command") return node.command;
	if (node.type === "wait" && node.until.kind === "command") {
		return node.until.command;
	}
	if (node.type === "call" && node.each?.source.kind === "command") {
		return node.each.source.command;
	}
	return undefined;
}

/**
 * The flow with `suggestion` applied to node `nodeId`, or to the flow:
 * - `prompt`: its text replaces `selection` in the node's prompt, or the
 *   whole prompt without one;
 * - `output`: the node's output schema (an Agent or a Value node);
 * - `set`: the node's variable writes, and the variables they need that
 *   the flow does not declare yet, added after the ones it has;
 * - `outcomes`: an Agent's own outcomes or a Decision's options, with the
 *   edges moved as `applyOutcomes` says;
 * - `rules`: the rule of each option it names;
 * - `expression`, `command`, `checker`, `arguments`: that field;
 * - `description`, `inputs`: the flow's.
 * A node that does not take the suggestion's kind, or no node by that id,
 * leaves the flow as it is.
 */
export function applySuggestion(
	flow: Flow,
	nodeId: string | undefined,
	suggestion: Suggestion,
	selection?: TextRange,
): Flow {
	if (suggestion.kind === "description") {
		const { description: _, ...rest } = flow;
		const description = suggestion.description.trim();
		return description === "" ? rest : { ...rest, description };
	}
	if (suggestion.kind === "inputs") return setInputs(flow, suggestion.inputs);
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (!node || nodeId === undefined || !takesSuggestion(node, suggestion.kind))
		return flow;
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
		case "outcomes":
			return applyOutcomes(flow, nodeId, suggestion.outcomes);
		case "rules": {
			const rules = new Map(suggestion.rules.map((r) => [r.option, r.when]));
			return updateNode(flow, nodeId, (current) => {
				if (current.type !== "decision") return current;
				const options = current.options.map((option) => {
					const when = rules.get(option.name)?.trim();
					if (when === undefined) return option;
					const { when: _, ...rest } = option;
					return when === "" ? rest : { ...rest, when };
				});
				return { ...current, options };
			});
		}
		case "expression":
			return updateNode(flow, nodeId, (current) =>
				current.type === "value"
					? { ...current, expression: suggestion.expression }
					: current,
			);
		case "command":
			return updateNode(flow, nodeId, (current) => {
				if (current.type === "command")
					return { ...current, command: suggestion.command };
				if (current.type === "wait" && current.until.kind === "command")
					return {
						...current,
						until: { ...current.until, command: suggestion.command },
					};
				if (current.type === "call" && current.each?.source.kind === "command")
					return {
						...current,
						each: {
							...current.each,
							source: { kind: "command", command: suggestion.command },
						},
					};
				return current;
			});
		case "checker":
			return updateNode(flow, nodeId, (current) => {
				if (current.type !== "agent" || !current.checker) return current;
				const { prompt: _, ...checker } = current.checker;
				const text = suggestion.text.trim();
				return {
					...current,
					checker: text === "" ? checker : { ...checker, prompt: text },
				};
			});
		case "arguments":
			return updateNode(flow, nodeId, (current) =>
				current.type === "tool"
					? { ...current, arguments: suggestion.arguments }
					: current,
			);
	}
}

/**
 * The flow with `outcomes` as the own outcomes of Agent node `nodeId`, or
 * the options of Decision node `nodeId`. An edge of the node keeps its
 * outcome when a new one has that name, moves to the new one whose `from`
 * names it, and goes otherwise. A Decision option without a rule keeps the
 * rule of the option it replaces.
 */
export function applyOutcomes(
	flow: Flow,
	nodeId: string,
	outcomes: readonly SuggestedOutcome[],
): Flow {
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	if (node?.type !== "agent" && node?.type !== "decision") return flow;
	const before = node.type === "decision" ? node.options : [];
	const options: NodeOption[] = outcomes.map(({ from, ...option }) => {
		const old = before.find((o) => o.name === (from ?? option.name));
		return option.when === undefined && old?.when !== undefined
			? { ...option, when: old.when }
			: option;
	});
	const names = new Set(options.map((option) => option.name));
	const moved = new Map<string, string>();
	for (const outcome of outcomes) {
		if (outcome.from && !names.has(outcome.from) && !moved.has(outcome.from))
			moved.set(outcome.from, outcome.name);
	}
	const next = updateNode(flow, nodeId, (current) =>
		current.type === "agent" || current.type === "decision"
			? withOptions(current, options)
			: current,
	);
	return {
		...next,
		edges: next.edges.flatMap((edge) => {
			if (edge.from !== nodeId || names.has(edge.outcome)) return [edge];
			const to = moved.get(edge.outcome);
			return to ? [{ ...edge, outcome: to }] : [];
		}),
	};
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

/** One item of a named list in a preview: an input, an argument, an option's rule. */
export type NamedChange<T> = { name: string; item: T; change: Change };

/**
 * The items of `after`, each marked new, changed or the same as the item
 * of `before` with its name, then the items `after` drops, marked removed.
 */
export function namedChanges<T>(
	before: readonly T[],
	after: readonly T[],
	nameOf: (item: T) => string,
): NamedChange<T>[] {
	const old = new Map(before.map((item) => [nameOf(item), item]));
	const kept = new Set(after.map(nameOf));
	return [
		...after.map((item) => {
			const name = nameOf(item);
			const previous = old.get(name);
			const change: Change =
				previous === undefined
					? "new"
					: JSON.stringify(previous) === JSON.stringify(item)
						? "same"
						: "changed";
			return { name, item, change };
		}),
		...before
			.filter((item) => !kept.has(nameOf(item)))
			.map((item) => ({
				name: nameOf(item),
				item,
				change: "removed" as const,
			})),
	];
}

/** The inputs an `inputs` suggestion gives, against the flow's. */
export function inputChanges(
	flow: Flow,
	inputs: readonly FlowInputDef[],
): NamedChange<FlowInputDef>[] {
	return namedChanges(flow.inputs, inputs, (input) => input.name);
}

/** The arguments an `arguments` suggestion gives, against the Tool node's. */
export function argumentChanges(
	node: FlowNode,
	args: Record<string, string>,
): NamedChange<[string, string]>[] {
	const before = node.type === "tool" ? Object.entries(node.arguments) : [];
	return namedChanges(before, Object.entries(args), ([name]) => name);
}

/** The options of a Decision with a `rules` suggestion applied, each marked by whether its rule changes. */
export function ruleChanges(
	flow: Flow,
	nodeId: string,
	rules: Extract<Suggestion, { kind: "rules" }>["rules"],
): NamedChange<NodeOption>[] {
	const before = flow.nodes.find((node) => node.id === nodeId);
	const after = applySuggestion(flow, nodeId, {
		kind: "rules",
		rules,
		note: "",
	}).nodes.find((node) => node.id === nodeId);
	if (before?.type !== "decision" || after?.type !== "decision") return [];
	return namedChanges(before.options, after.options, (option) => option.name);
}

/** One outcome of an `outcomes` suggestion, in a preview. */
export type OutcomeChange = {
	outcome: NodeOption;
	change: Change;
	/** The outcome it replaces, whose edges move to it. */
	from?: string;
};

/**
 * What an `outcomes` suggestion changes on node `nodeId`: its outcomes,
 * each new, renamed (`from`), changed or the same, then the ones it drops;
 * and the edges that go with the dropped ones.
 */
export function outcomeChanges(
	flow: Flow,
	nodeId: string,
	outcomes: readonly SuggestedOutcome[],
): { outcomes: OutcomeChange[]; droppedEdges: number } {
	const node = flow.nodes.find((candidate) => candidate.id === nodeId);
	const before: NodeOption[] =
		node?.type === "decision"
			? node.options
			: node?.type === "agent"
				? (node.outcomes ?? nodeOutcomes(node).map((name) => ({ name })))
				: [];
	const names = new Set(outcomes.map((outcome) => outcome.name));
	const replaced = new Set<string>();
	const rows: OutcomeChange[] = outcomes.map(({ from, ...outcome }) => {
		const previous = before.find((o) => o.name === outcome.name);
		if (previous) {
			const same =
				previous.description === outcome.description &&
				previous.color === outcome.color &&
				(outcome.when === undefined || previous.when === outcome.when);
			return { outcome, change: same ? "same" : "changed" };
		}
		if (from && !names.has(from) && before.some((o) => o.name === from)) {
			replaced.add(from);
			return { outcome, change: "changed", from };
		}
		return { outcome, change: "new" };
	});
	const removed = before
		.filter((o) => !names.has(o.name) && !replaced.has(o.name))
		.map((outcome) => ({ outcome, change: "removed" as const }));
	const after = applyOutcomes(flow, nodeId, outcomes);
	return {
		outcomes: [...rows, ...removed],
		droppedEdges: flow.edges.length - after.edges.length,
	};
}
