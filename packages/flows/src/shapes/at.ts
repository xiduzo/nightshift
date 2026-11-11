/**
 * What a JSON Schema says is below a path: a template's keys below a JSON
 * field (`{{plan.data.tasks.0.title}}`) read into the shape of that field.
 * Keys follow the template rules: an object's own key, or an array index.
 */

type Schema = Record<string, unknown>;

/**
 * What a shape holds at a path.
 * - `found`: the path is in the shape, and `schema` is what it holds there.
 * - `open`: the shape does not say (no properties, `anyOf`, `$ref` and so
 *   on). Any path passes.
 * - `missing`: the key `path[index]` is not in the shape. `keys` are the
 *   keys it has at that place, for a message.
 */
export type SchemaAt =
	| { kind: "found"; schema: Schema }
	| { kind: "open" }
	| { kind: "missing"; index: number; keys: readonly string[] };

const INDEX = /^(0|[1-9][0-9]*)$/;

/** Keys that make a schema hard to read by path: then it is open. */
const COMBINATORS = ["anyOf", "oneOf", "allOf", "$ref", "not", "if"] as const;

/** The JSON Schema types that hold no keys. */
const SCALARS = ["string", "number", "integer", "boolean", "null"];

/** What `schema` holds at `path`. An empty path is the schema itself. */
export function schemaAt(schema: unknown, path: readonly string[]): SchemaAt {
	let current: unknown = schema;
	for (const [index, key] of path.entries()) {
		const next = childOf(current, key);
		if (next === "open") return { kind: "open" };
		if (next === "missing") {
			return { kind: "missing", index, keys: keysOf(current) };
		}
		current = next;
	}
	return isRecord(current)
		? { kind: "found", schema: current }
		: { kind: "open" };
}

/** The keys a schema has for a path: its properties, or none. */
export function keysOf(schema: unknown): readonly string[] {
	if (!isRecord(schema) || !isRecord(schema.properties)) return [];
	return Object.keys(schema.properties);
}

function childOf(schema: unknown, key: string): Schema | "open" | "missing" {
	if (!isRecord(schema)) return "open";
	if (COMBINATORS.some((name) => name in schema)) return "open";
	const type = typeOf(schema);
	if (type === undefined) return "open";
	if (SCALARS.includes(type)) return "missing";
	if (type === "array") {
		if (!INDEX.test(key)) return "missing";
		return isRecord(schema.items) ? schema.items : "open";
	}
	// An object.
	if (isRecord(schema.properties) && Object.hasOwn(schema.properties, key)) {
		const child = schema.properties[key];
		return isRecord(child) ? child : "open";
	}
	if (isRecord(schema.additionalProperties)) return schema.additionalProperties;
	return isRecord(schema.properties) ? "missing" : "open";
}

/** One JSON Schema type, or undefined when it names none or several. */
function typeOf(schema: Schema): string | undefined {
	if (typeof schema.type === "string") return schema.type;
	if (schema.type === undefined && "properties" in schema) return "object";
	if (schema.type === undefined && "items" in schema) return "array";
	return undefined;
}

function isRecord(value: unknown): value is Schema {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
