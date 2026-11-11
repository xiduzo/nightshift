/**
 * The shape of one real value, as a JSON Schema: what a step gave when its
 * node has no output schema. Night Shift keeps it on the node as inferred
 * (`outputInferred`), and the editor shows it until a person confirms it.
 *
 * Our own small module, not a library (the owner prefers libraries): no
 * library fits. It must run in the browser and on the engine, and give
 * only the plain subset of JSON Schema that the shape model shows
 * (`fromJsonSchema`), with caps on depth and size.
 */

type Schema = Record<string, unknown>;

/** How deep the shape goes. Below it a value is open: `{}`. */
export const INFER_MAX_DEPTH = 6;
/** How many properties the shape names in all. Past it an object is open. */
export const INFER_MAX_PROPERTIES = 200;

/**
 * The shape of `value`. An object lists its keys, a list the shape its
 * elements share. Nothing is `required`: one value cannot tell. Past
 * `INFER_MAX_DEPTH` or `INFER_MAX_PROPERTIES` the shape is open, so a path
 * there never warns.
 */
export function inferSchema(value: unknown): Schema {
	const budget = { properties: INFER_MAX_PROPERTIES };
	return infer(value, 0, budget);
}

function infer(
	value: unknown,
	depth: number,
	budget: { properties: number },
): Schema {
	if (value === null) return { type: "null" };
	switch (typeof value) {
		case "string":
			return { type: "string" };
		case "boolean":
			return { type: "boolean" };
		case "number":
			return { type: Number.isInteger(value) ? "integer" : "number" };
		case "object":
			break;
		default:
			return {};
	}
	if (depth >= INFER_MAX_DEPTH) return {};
	if (Array.isArray(value)) {
		if (value.length === 0) return { type: "array" };
		const items = value
			.map((item) => infer(item, depth + 1, budget))
			.reduce(merge);
		return Object.keys(items).length === 0
			? { type: "array" }
			: { type: "array", items };
	}
	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length > budget.properties) return { type: "object" };
	budget.properties -= entries.length;
	return {
		type: "object",
		properties: Object.fromEntries(
			entries.map(([key, child]) => [key, infer(child, depth + 1, budget)]),
		),
	};
}

/**
 * One shape for two values of a list: the same type stays, a whole number
 * and a number are a number, two objects have the keys of both. Any other
 * pair is open (`{}`).
 */
function merge(a: Schema, b: Schema): Schema {
	if (a.type === b.type) {
		if (a.type === "object") return mergeObjects(a, b);
		if (a.type === "array") {
			if (a.items === undefined) return b;
			if (b.items === undefined) return a;
			const items = merge(a.items as Schema, b.items as Schema);
			return Object.keys(items).length === 0
				? { type: "array" }
				: { type: "array", items };
		}
		return a;
	}
	const numbers = ["integer", "number"];
	if (numbers.includes(String(a.type)) && numbers.includes(String(b.type))) {
		return { type: "number" };
	}
	return {};
}

function mergeObjects(a: Schema, b: Schema): Schema {
	const left = a.properties as Record<string, Schema> | undefined;
	const right = b.properties as Record<string, Schema> | undefined;
	// An object past the budget is open: the merge is open too.
	if (left === undefined || right === undefined) return { type: "object" };
	const properties: Record<string, Schema> = { ...left };
	for (const [key, schema] of Object.entries(right)) {
		const known = properties[key];
		properties[key] = known === undefined ? schema : merge(known, schema);
	}
	return { type: "object", properties };
}
