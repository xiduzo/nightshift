/** Free names for new nodes, inputs, outputs and edges. */
import type { Flow } from "../document";

/**
 * The names a template can read in this flow: node ids, inputs and
 * variables share one namespace, and `run` and `vars` are reserved.
 */
export function takenNames(flow: Flow): Set<string> {
	return new Set([
		"run",
		"vars",
		...flow.nodes.map((node) => node.id),
		...flow.inputs.map((input) => input.name),
		...(flow.variables ?? []).map((variable) => variable.name),
	]);
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
