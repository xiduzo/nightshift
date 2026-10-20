/**
 * A small, zod-like model of the JSON Schemas the output builder can show:
 * text, numbers, yes/no, a choice of strings, lists and objects. The flow
 * file keeps JSON Schema; this model is only how the editor shows it.
 */

type Schema = Record<string, unknown>;

export type ShapeKind =
	| "text"
	| "number"
	| "integer"
	| "boolean"
	| "choice"
	| "list"
	| "object";

export type SchemaShape =
	| { kind: "text" | "number" | "integer" | "boolean"; description?: string }
	| { kind: "choice"; values: string[]; description?: string }
	| { kind: "list"; items: SchemaShape; description?: string }
	| { kind: "object"; fields: SchemaField[]; description?: string };

/** One property of an object. Its description lives on `shape`. */
export type SchemaField = {
	name: string;
	required: boolean;
	shape: SchemaShape;
};

/** The kinds in the order the type picker shows them. */
export const SHAPE_KINDS: { kind: ShapeKind; label: string }[] = [
	{ kind: "text", label: "Text" },
	{ kind: "number", label: "Number" },
	{ kind: "integer", label: "Whole number" },
	{ kind: "boolean", label: "Yes or no" },
	{ kind: "choice", label: "Choice" },
	{ kind: "list", label: "List" },
	{ kind: "object", label: "Object" },
];

const SIMPLE_TYPES = {
	text: "string",
	number: "number",
	integer: "integer",
	boolean: "boolean",
} as const;

/** A new shape of `kind`, keeping `description`. */
export function emptyShape(kind: ShapeKind, description?: string): SchemaShape {
	const base = description === undefined ? {} : { description };
	switch (kind) {
		case "choice":
			return { kind, values: [], ...base };
		case "list":
			return { kind, items: { kind: "text" }, ...base };
		case "object":
			return { kind, fields: [], ...base };
		default:
			return { kind, ...base };
	}
}

export function toJsonSchema(shape: SchemaShape): Schema {
	const schema: Schema = {};
	switch (shape.kind) {
		case "choice":
			schema.type = "string";
			schema.enum = [...shape.values];
			break;
		case "list":
			schema.type = "array";
			schema.items = toJsonSchema(shape.items);
			break;
		case "object": {
			schema.type = "object";
			if (shape.fields.length > 0) {
				schema.properties = Object.fromEntries(
					shape.fields.map((field) => [field.name, toJsonSchema(field.shape)]),
				);
			}
			const required = shape.fields
				.filter((field) => field.required)
				.map((field) => field.name);
			if (required.length > 0) schema.required = required;
			break;
		}
		default:
			schema.type = SIMPLE_TYPES[shape.kind];
	}
	if (shape.description !== undefined) schema.description = shape.description;
	return schema;
}

function isRecord(value: unknown): value is Schema {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function onlyKeys(schema: Schema, allowed: readonly string[]): boolean {
	return Object.keys(schema).every((key) => allowed.includes(key));
}

/**
 * The shape of a JSON Schema, or null when it uses something the builder
 * cannot show (anyOf, $ref, formats, limits and so on).
 */
export function fromJsonSchema(schema: unknown): SchemaShape | null {
	if (!isRecord(schema)) return null;
	const { description } = schema;
	if (description !== undefined && typeof description !== "string") return null;
	const base = description === undefined ? {} : { description };
	const type = schema.type ?? ("properties" in schema ? "object" : undefined);

	switch (type) {
		case "string": {
			if (!("enum" in schema)) {
				return onlyKeys(schema, ["type", "description"])
					? { kind: "text", ...base }
					: null;
			}
			const values = schema.enum;
			if (
				!onlyKeys(schema, ["type", "description", "enum"]) ||
				!Array.isArray(values) ||
				!values.every((value) => typeof value === "string")
			) {
				return null;
			}
			return { kind: "choice", values: [...values], ...base };
		}
		case "number":
		case "integer":
		case "boolean":
			if (!onlyKeys(schema, ["type", "description"])) return null;
			return { kind: type as "number" | "integer" | "boolean", ...base };
		case "array": {
			if (!onlyKeys(schema, ["type", "description", "items"])) return null;
			const items =
				schema.items === undefined ? null : fromJsonSchema(schema.items);
			return items ? { kind: "list", items, ...base } : null;
		}
		case "object": {
			if (!onlyKeys(schema, ["type", "description", "properties", "required"]))
				return null;
			const properties = schema.properties ?? {};
			const required = schema.required ?? [];
			if (
				!isRecord(properties) ||
				!Array.isArray(required) ||
				!required.every(
					(name) => typeof name === "string" && name in properties,
				)
			) {
				return null;
			}
			const fields: SchemaField[] = [];
			for (const [name, property] of Object.entries(properties)) {
				const shape = fromJsonSchema(property);
				if (!shape) return null;
				fields.push({ name, required: required.includes(name), shape });
			}
			return { kind: "object", fields, ...base };
		}
		default:
			return null;
	}
}

const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Why `name` cannot be a field name next to `others`, or null when it can. */
export function fieldNameProblem(
	name: string,
	others: readonly string[],
): string | null {
	if (name === "") return "Give the field a name.";
	if (!FIELD_NAME.test(name))
		return "Use letters, digits and _, starting with a letter.";
	if (others.includes(name)) return "Another field has this name.";
	return null;
}

/** Whether every field name is valid and unique, and every Choice has values. */
export function shapeIsValid(shape: SchemaShape): boolean {
	switch (shape.kind) {
		case "choice":
			return shape.values.length > 0;
		case "list":
			return shapeIsValid(shape.items);
		case "object":
			return shape.fields.every(
				(field, index) =>
					fieldNameProblem(
						field.name,
						shape.fields.filter((_, at) => at !== index).map((f) => f.name),
					) === null && shapeIsValid(field.shape),
			);
		default:
			return true;
	}
}
