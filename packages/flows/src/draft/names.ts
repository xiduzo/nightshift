/** Free names for new nodes, inputs, outputs and edges, and the clash of a new name. */
import type { Flow } from "../flow";
import { reservedNames } from "../nodes";

/**
 * The names a template can read in this flow: node ids, inputs and
 * variables share one namespace, and `run` and `vars` are reserved.
 */
export function takenNames(flow: Flow): Set<string> {
	return new Set([
		...reservedNames,
		...flow.nodes.map((node) => node.id),
		...flow.inputs.map((input) => input.name),
		...(flow.variables ?? []).map((variable) => variable.name),
	]);
}

/** What a name clashes with in the one namespace of a flow. */
export type NameClash = "reserved" | "node" | "input" | "variable";

/** The thing that takes the name: it may keep its own name. */
export type NameOwner =
	| { node: string }
	| { input: number }
	| { variable: number };

/**
 * What `name` clashes with when `owner` takes it: a reserved name (`run`,
 * `vars`), another node, input or variable. Null when the name is free.
 * Validation refuses a flow with a clash, so an edit checks here first.
 */
export function nameClash(
	flow: Flow,
	name: string,
	owner: NameOwner,
): NameClash | null {
	const reserved: readonly string[] = reservedNames;
	if (reserved.includes(name)) return "reserved";
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
