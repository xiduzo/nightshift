import type { TemplateField, TemplateScope } from "../validate";

/**
 * Value presets: a Value by rule that a person starts from instead of
 * writing JSONata. Each preset turns a list (`source`), a few fields and
 * the shape of the list's items into an `expression` and an `output`
 * schema. The result is a plain Value by rule: the flow file holds no
 * preset, so a person can change the expression afterwards. The data is
 * always `{ items: [...] }`, read later as `{{<node>.data.items}}`.
 */

type Schema = Record<string, unknown>;

/** The presets, in the order the editor shows them. */
export const VALUE_PRESETS = [
	{
		name: "filter",
		label: "Filter",
		description: "Keep the items whose field matches a value.",
	},
	{
		name: "pick",
		label: "Pick fields",
		description: "Keep only some fields of each item.",
	},
	{
		name: "sort",
		label: "Sort",
		description: "Put the items in order of a field.",
	},
	{ name: "limit", label: "Limit", description: "Keep the first items only." },
	{
		name: "unique",
		label: "Remove duplicates",
		description: "Keep the first item of each value of a field.",
	},
] as const;
export type ValuePresetName = (typeof VALUE_PRESETS)[number]["name"];

/** How a Filter compares the field of an item with its value. */
export const FILTER_COMPARES = [
	{ compare: "equals", label: "is" },
	{ compare: "differs", label: "is not" },
	{ compare: "contains", label: "contains" },
	{ compare: "above", label: "is more than" },
	{ compare: "below", label: "is less than" },
	{ compare: "exists", label: "has a value" },
] as const;
export type FilterCompare = (typeof FILTER_COMPARES)[number]["compare"];

/**
 * What a person fills in for a preset. `source` is a reference without
 * braces (`news.data.items`). An empty `field` is the item itself, for a
 * list of plain values.
 */
export type ValuePresetInput =
	| {
			preset: "filter";
			source: string;
			field: string;
			compare: FilterCompare;
			value: string;
	  }
	| { preset: "pick"; source: string; fields: readonly string[] }
	| {
			preset: "sort";
			source: string;
			field: string;
			order: "ascending" | "descending";
	  }
	| { preset: "limit"; source: string; count: number }
	| { preset: "unique"; source: string; field: string };

/** A list a preset can start from: its reference and the shape of one item (`{}` when not known). */
export type PresetSource = { ref: string; item: Schema };

/** What a preset gives a Value by rule. */
export type ValuePresetResult = { expression: string; output: Schema };

/**
 * The lists a preset in node `nodeId` can start from: every input,
 * variable and output field of another node whose shape is a list, and
 * every list one level below one (`news.data.items`).
 */
export function presetSources(
	scope: TemplateScope,
	nodeId: string,
): PresetSource[] {
	const sources: PresetSource[] = [];
	const add = (field: TemplateField) => {
		for (const candidate of [field, ...(field.keys ?? [])]) {
			const item = listItem(candidate.schema);
			if (item !== null) sources.push({ ref: candidate.ref, item });
		}
	};
	for (const field of scope.inputs) add(field);
	for (const field of scope.vars ?? []) add(field);
	for (const node of scope.nodes) {
		if (node.id !== nodeId) for (const field of node.fields) add(field);
	}
	return sources;
}

/** The fields of an item shape that a preset can name, in order. */
export function itemFields(item: Schema): string[] {
	const properties = item.properties;
	if (properties === null || typeof properties !== "object") return [];
	return Object.keys(properties);
}

/**
 * The expression and output schema of a preset. `item` is the shape of
 * one item of the source (`PresetSource.item`): it types the output, and
 * it says whether a field holds numbers or a list.
 */
export function valuePreset(
	input: ValuePresetInput,
	item: Schema = {},
): ValuePresetResult {
	const source = jsonataPath(input.source);
	switch (input.preset) {
		case "filter":
			return result(
				`$filter(${source}, function($v) { ${condition(input, item)} })`,
				item,
			);
		case "pick": {
			const entries = input.fields.map(
				(field) => `${JSON.stringify(field)}: ${fieldOf("$v", field)}`,
			);
			return result(
				`$map(${source}, function($v) { {${entries.join(", ")}} })`,
				picked(item, input.fields),
			);
		}
		case "sort": {
			const after = input.order === "ascending" ? ">" : "<";
			return result(
				`$sort(${source}, function($a, $b) { ${fieldOf("$a", input.field)} ${after} ${fieldOf("$b", input.field)} })`,
				item,
			);
		}
		case "limit":
			return result(
				`$filter(${source}, function($v, $i) { $i < ${Math.max(0, Math.floor(input.count))} })`,
				item,
			);
		case "unique":
			return result(
				input.field === ""
					? `$distinct(${source})`
					: `$reduce(${source}, function($kept, $v) { ${fieldOf("$v", input.field)} in ${fieldOf("$kept", input.field)} ? $kept : $append($kept, $v) }, [])`,
				item,
			);
	}
}

/** `{ "items": [...] }`, always a list: one item or none stays a list. */
function result(list: string, item: Schema): ValuePresetResult {
	const items: Schema =
		Object.keys(item).length === 0
			? { type: "array" }
			: { type: "array", items: item };
	return {
		expression: `{"items": [${list}]}`,
		output: {
			type: "object",
			properties: { items: items },
			required: ["items"],
		},
	};
}

/** The test of a Filter on one item `$v`. */
function condition(
	input: Extract<ValuePresetInput, { preset: "filter" }>,
	item: Schema,
): string {
	const field = fieldOf("$v", input.field);
	const shape = fieldShape(item, input.field);
	switch (input.compare) {
		case "equals":
			return `${field} = ${literal(input.value, shape)}`;
		case "differs":
			return `${field} != ${literal(input.value, shape)}`;
		case "contains":
			return shape.type === "array"
				? `${literal(input.value, itemShape(shape))} in ${field}`
				: `$contains($string(${field}), ${JSON.stringify(input.value)})`;
		case "above":
		case "below": {
			const sign = input.compare === "above" ? ">" : "<";
			const number = Number(input.value.trim());
			if (input.value.trim() === "" || !Number.isFinite(number)) {
				// Text compares as text: an ISO date is later when it is more.
				return `$string(${field}) ${sign} ${JSON.stringify(input.value)}`;
			}
			const numeric = shape.type === "number" || shape.type === "integer";
			return `${numeric ? field : `$number(${field})`} ${sign} ${number}`;
		}
		case "exists":
			return `$exists(${field})`;
	}
}

/**
 * The value a Filter compares with, as JSONata: text for a text field, a
 * number or true or false when the field holds one, and when the shape
 * does not say, whatever the text reads as.
 */
function literal(value: string, shape: Schema): string {
	const text = value.trim();
	const number = Number(text);
	const isNumber = text !== "" && Number.isFinite(number);
	const isBoolean = text === "true" || text === "false";
	switch (shape.type) {
		case "string":
			return JSON.stringify(value);
		case "number":
		case "integer":
			return isNumber ? String(number) : JSON.stringify(value);
		case "boolean":
			return isBoolean ? text : JSON.stringify(value);
		default:
			if (isNumber) return String(number);
			if (isBoolean) return text;
			return JSON.stringify(value);
	}
}

/** The item shape with only the picked fields, none of them required. */
function picked(item: Schema, fields: readonly string[]): Schema {
	return {
		type: "object",
		properties: Object.fromEntries(
			fields.map((field) => [field, fieldShape(item, field)]),
		),
	};
}

/** The shape of one field of an item; `{}` when the shape does not say. The item itself for "". */
function fieldShape(item: Schema, field: string): Schema {
	if (field === "") return item;
	const properties = item.properties;
	if (properties === null || typeof properties !== "object") return {};
	const shape = (properties as Record<string, unknown>)[field];
	return shape !== null && typeof shape === "object" ? (shape as Schema) : {};
}

/** The item shape of a list shape: `{}` when it does not say. */
function itemShape(list: Schema): Schema {
	const items = list.items;
	return items !== null && typeof items === "object" && !Array.isArray(items)
		? (items as Schema)
		: {};
}

/** The item shape when `schema` is a list, else null. */
function listItem(schema: Schema | undefined): Schema | null {
	if (schema?.type !== "array") return null;
	return itemShape(schema);
}

/** `$v.title`, `` $v.`first name` ``, or `$v` itself for "". */
function fieldOf(variable: string, field: string): string {
	return field === "" ? variable : `${variable}.${jsonataName(field)}`;
}

/** A reference as a JSONata path: each name that JSONata cannot take bare goes in backticks. */
export function jsonataPath(ref: string): string {
	return ref.split(".").map(jsonataName).join(".");
}

/** Words JSONata reads as its own, so a name that is one goes in backticks. */
const JSONATA_WORDS = new Set([
	"and",
	"or",
	"in",
	"true",
	"false",
	"null",
	"function",
]);

function jsonataName(name: string): string {
	return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !JSONATA_WORDS.has(name)
		? name
		: `\`${name.replace(/`/g, "")}\``;
}
