/**
 * One line on what a value holds, for the viewer on a node and the
 * samples in the template picker: the first line of a text, a number,
 * yes or no, "12 items · first: …", the fields of a record, the name of a
 * file. Outputs can be large (an End report, an agent's data), so a gist
 * reads only the start of a text and the first item of a list, and a list
 * or record keeps its gist once it is made.
 */
import { type NodeSample, stepOutcomeLabel } from "@nightshift/client";
import {
	FILE_FORMAT,
	type FlowNode,
	type JsonValue,
	mainOutputField,
	outputFieldShape,
	SHAPE_KINDS,
	type ShapeKind,
} from "@nightshift/flows";

type Schema = Record<string, unknown>;

/** The most characters a gist shows. The canvas cuts it shorter. */
export const GIST_MAX = 120;
/** How much of a text a gist reads to find its line. */
const TEXT_SCAN = 2000;
/** How many fields of a record a gist names. */
const RECORD_KEYS = 3;
/** The fields that name an item best, first one wins. */
const ITEM_NAMES = ["title", "name", "label", "id", "url"];

/** A list's or record's gist, made once per value. */
const made = new WeakMap<object, string | null>();

/**
 * What `value` holds, in one line, or null when it holds nothing to show
 * (missing, null, or empty text). `shape` marks a text as a file
 * (`format: file`). `lastLine`: a log reads from its end.
 */
export function gist(
	value: JsonValue | undefined,
	options: { shape?: Schema; lastLine?: boolean } = {},
): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value === "string") {
		return options.shape?.format === FILE_FORMAT
			? fileName(value)
			: textLine(value, options.lastLine === true);
	}
	if (typeof value === "number") return String(value);
	if (typeof value === "boolean") return value ? "Yes" : "No";
	const known = made.get(value);
	if (known !== undefined) return known;
	const line = Array.isArray(value) ? listGist(value) : recordGist(value);
	made.set(value, line);
	return line;
}

/** The first line of a text with words on it, or its last one. */
function textLine(text: string, last: boolean): string | null {
	const part = last ? text.slice(-TEXT_SCAN) : text.slice(0, TEXT_SCAN);
	const lines = part
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	const line = last ? lines.at(-1) : lines[0];
	return line === undefined ? null : cut(line, GIST_MAX);
}

/** The name of a file, from its path. */
function fileName(path: string): string | null {
	const name = path.trim().split(/[\\/]/).at(-1);
	return name ? cut(name, GIST_MAX) : null;
}

function listGist(list: readonly JsonValue[]): string {
	if (list.length === 0) return "No items";
	const count = `${list.length} ${list.length === 1 ? "item" : "items"}`;
	const first = itemGist(list[0]);
	return first === null ? count : `${count} · first: ${first}`;
}

function recordGist(record: { [key: string]: JsonValue }): string {
	const keys = Object.keys(record);
	if (keys.length === 0) return "No fields";
	const named = keys.slice(0, RECORD_KEYS).join(", ");
	const more = keys.length > RECORD_KEYS ? ", …" : "";
	return `${keys.length} ${keys.length === 1 ? "field" : "fields"}: ${named}${more}`;
}

/** An item of a list in a few words: a record by its title or name. */
function itemGist(item: JsonValue | undefined): string | null {
	if (item === undefined || item === null) return null;
	if (typeof item === "object" && !Array.isArray(item)) {
		for (const key of ITEM_NAMES) {
			const name = item[key];
			if (typeof name === "string" || typeof name === "number")
				return gist(name);
		}
		return gist(item);
	}
	if (Array.isArray(item)) {
		return `${item.length} ${item.length === 1 ? "item" : "items"}`;
	}
	return gist(item);
}

function cut(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** What the viewer strip of a node shows, once the flow has a run. */
export type SampleLine =
	| { kind: "running" }
	| { kind: "absent" }
	| { kind: "output"; text: string; field: string };

/**
 * The viewer line of `node` from its sample: "Running", "Not in the last
 * run", or the gist of its main output. A step that gave nothing there
 * shows the outcome it ended on.
 */
export function sampleLine(
	node: FlowNode,
	sample: Pick<NodeSample, "endedAt" | "outcome" | "outputs"> | undefined,
): SampleLine {
	if (sample === undefined) return { kind: "absent" };
	if (sample.endedAt === null) return { kind: "running" };
	const field = mainOutputField(node);
	const { outputs } = sample;
	const text =
		gist(Object.hasOwn(outputs, field) ? outputs[field] : undefined, {
			shape: outputFieldShape(node, field),
			lastLine: field === "log_tail",
		}) ?? (sample.outcome ? stepOutcomeLabel(sample.outcome) : "No output");
	return { kind: "output", text, field };
}

/**
 * The shape of an output field as a word ("Text", "List", "Record"): the
 * field's shape when it says, else what the value holds. Null for a
 * missing or null value of a field without a shape.
 */
export function shapeLabel(
	value: JsonValue | undefined,
	shape: Schema | undefined,
): string | null {
	const kind = shapeKindOf(shape) ?? valueKind(value);
	return kind === null
		? null
		: (SHAPE_KINDS.find((entry) => entry.kind === kind)?.label ?? null);
}

function shapeKindOf(shape: Schema | undefined): ShapeKind | null {
	if (shape === undefined) return null;
	if (shape.format === FILE_FORMAT) return "file";
	switch (shape.type) {
		case "string":
			return Array.isArray(shape.enum) ? "choice" : "text";
		case "integer":
			return "integer";
		case "number":
			return "number";
		case "boolean":
			return "boolean";
		case "array":
			return "list";
		case "object":
			return "object";
		default:
			return null;
	}
}

function valueKind(value: JsonValue | undefined): ShapeKind | null {
	if (value === undefined || value === null) return null;
	if (typeof value === "string") return "text";
	if (typeof value === "number")
		return Number.isInteger(value) ? "integer" : "number";
	if (typeof value === "boolean") return "boolean";
	return Array.isArray(value) ? "list" : "object";
}
