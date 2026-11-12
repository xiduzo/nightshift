/** Free names for new nodes, inputs, outputs and edges, and the clash of a new name. */
import type { Flow } from "../flow";
import { reservedNames, ruleOwnNames, templateOwnNames } from "../nodes";

/**
 * The names a new node, input or variable does not get: node ids, inputs
 * and variables share one namespace, `run` and `vars` are reserved, a
 * rule reads `previous` and `current` as its own (`ruleOwnNames`), and a
 * node with a cascade reads `cascade` (`templateOwnNames`).
 */
export function takenNames(flow: Flow): Set<string> {
	return new Set([
		...reservedNames,
		...ruleOwnNames,
		...templateOwnNames,
		...flow.nodes.map((node) => node.id),
		...flow.inputs.map((input) => input.name),
		...(flow.variables ?? []).map((variable) => variable.name),
	]);
}

/**
 * What a name clashes with in the one namespace of a flow. `rule`: a
 * name a rule reads as its own (`ruleOwnNames`), for a node or an input.
 * `template`: a name a template reads as its own (`templateOwnNames`),
 * for a node or an input.
 */
export type NameClash =
	| "reserved"
	| "rule"
	| "template"
	| "node"
	| "input"
	| "variable";

/** The thing that takes the name: it may keep its own name. */
export type NameOwner =
	| { node: string }
	| { input: number }
	| { variable: number };

/**
 * What `name` clashes with when `owner` takes it: a reserved name (`run`,
 * `vars`), another node, input or variable. Null when the name is free.
 * Validation refuses a flow with a clash, so an edit checks here first.
 * A node or an input does not take a name a rule or a template reads as
 * its own (`previous`, `cascade`). The check only warns about a flow that
 * has one already, so a node or an input that has it may keep it.
 */
export function nameClash(
	flow: Flow,
	name: string,
	owner: NameOwner,
): NameClash | null {
	const reserved: readonly string[] = reservedNames;
	if (reserved.includes(name)) return "reserved";
	const ruleOwn: readonly string[] = ruleOwnNames;
	if (ruleOwn.includes(name) && !keepsName(flow, name, owner)) return "rule";
	const templateOwn: readonly string[] = templateOwnNames;
	if (templateOwn.includes(name) && !keepsName(flow, name, owner))
		return "template";
	if (
		flow.nodes.some(
			(node) => node.id === name && !("node" in owner && owner.node === name),
		)
	) {
		return "node";
	}
	if (
		flow.inputs.some(
			(input, index) =>
				input.name === name && !("input" in owner && owner.input === index),
		)
	) {
		return "input";
	}
	if (
		(flow.variables ?? []).some(
			(variable, index) =>
				variable.name === name &&
				!("variable" in owner && owner.variable === index),
		)
	) {
		return "variable";
	}
	return null;
}

/** Whether `owner` is a variable, or a node or an input that has `name` already. */
function keepsName(flow: Flow, name: string, owner: NameOwner): boolean {
	if ("variable" in owner) return true;
	if ("node" in owner) return owner.node === name;
	return flow.inputs[owner.input]?.name === name;
}

/** `base`, else `base_2`, `base_3`, … whichever no node or input uses yet. */
export function uniqueName(flow: Flow, base: string): string {
	const taken = takenNames(flow);
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const name = `${base}_${n}`;
		if (!taken.has(name)) return name;
	}
}

/** `base`, else `base_2`, … among the flow's outputs. */
export function uniqueOutputName(flow: Flow, base: string): string {
	const taken = new Set(flow.outputs.map((output) => output.name));
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const name = `${base}_${n}`;
		if (!taken.has(name)) return name;
	}
}

/** `base`, else `base_2`, `base_3`, … whichever is free. */
export function uniqueNodeId(flow: Flow, base: string): string {
	return uniqueName(flow, base);
}

export function uniqueEdgeId(flow: Flow, base: string): string {
	const taken = new Set(flow.edges.map((edge) => edge.id));
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const id = `${base}-${n}`;
		if (!taken.has(id)) return id;
	}
}
