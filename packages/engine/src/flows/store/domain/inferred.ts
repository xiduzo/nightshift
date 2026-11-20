import { type FlowNode, typedOutput } from "@nightshift/flows";

/** What a run saw of a step's data: the shape of each field, by field. */
export type StepShapes = Record<string, Record<string, unknown>>;

/** The type a run gave the value of a flow output. */
export type OutputType = {
	name: string;
	value: string;
	type: string;
	schema?: Record<string, unknown>;
};

/**
 * The node as it keeps the shape a run's step saw: its `output` becomes the
 * shape of the field it types, marked inferred (`outputInferred`). Null
 * when the stored node is gone, of another type, or has a schema already:
 * a person's schema always wins.
 */
export function nodeWithShape(
	stored: unknown,
	type: string,
	shapes: StepShapes,
): Record<string, unknown> | null {
	if (typeof stored !== "object" || stored === null) return null;
	const node = stored as FlowNode;
	if (node.type !== type) return null;
	const typed = typedOutput(node);
	if (typed === null || typed.schema !== undefined) return null;
	const shape = shapes[typed.field];
	if (shape === undefined) return null;
	return { ...node, output: shape, outputInferred: true };
}

/**
 * The outputs of a flow as they keep the types a run gave them: each output
 * named in `types` that has no type yet and still has the template the run
 * read gets its `type` (and `schema`), marked `inferred`. Null when no
 * output takes a type: a person's type always wins.
 */
export function outputsWithTypes(
	stored: unknown,
	types: readonly OutputType[],
): Record<string, unknown>[] | null {
	if (!Array.isArray(stored)) return null;
	let changed = false;
	const outputs = (stored as Record<string, unknown>[]).map((output) => {
		const kept = types.find(
			(type) => type.name === output.name && type.value === output.value,
		);
		if (
			kept === undefined ||
			output.type !== undefined ||
			output.schema !== undefined
		) {
			return output;
		}
		changed = true;
		return {
			...output,
			type: kept.type,
			...(kept.schema !== undefined ? { schema: kept.schema } : {}),
			inferred: true,
		};
	});
	return changed ? outputs : null;
}
