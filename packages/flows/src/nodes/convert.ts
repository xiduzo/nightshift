import { z } from "zod";
import {
	jsonSchemaSchema,
	type NodeCheck,
	nodeBase,
	outputInferredSchema,
} from "./base";
import {
	type BuiltInOutcome,
	endsOnPass,
	type NodeDefinition,
	noEndedLabel,
	noOwnColors,
	noSecrets,
	type Position,
} from "./definition";

/**
 * The Convert node: it turns text of one format into JSON, or JSON into
 * text of a format, with no model, no shell and no computer of its own. It
 * also turns HTML into plain text. Pure: a visit gives the same result for
 * the same value, so it runs anywhere, a Host without a shell included.
 */

/** The formats a Convert node reads or writes. */
export const CONVERT_FORMATS = [
	"json",
	"csv",
	"yaml",
	"xml",
	"feed",
	"markdown-table",
	"html",
	"text",
] as const;
export const convertFormatSchema = z.enum(CONVERT_FORMATS);
export type ConvertFormat = z.infer<typeof convertFormatSchema>;

/** What a person calls each format. */
export const CONVERT_FORMAT_LABEL = {
	json: "JSON",
	csv: "CSV",
	yaml: "YAML",
	xml: "XML",
	feed: "RSS or Atom feed",
	"markdown-table": "Markdown table",
	html: "HTML",
	text: "Text",
} as const satisfies Record<ConvertFormat, string>;

/**
 * The conversions a Convert node does, `from` first: one side is JSON,
 * apart from HTML to text. A feed is read only: its items come out in one
 * fixed shape (`shapes/convert.ts`).
 */
export const CONVERT_PAIRS = [
	{ from: "csv", to: "json" },
	{ from: "json", to: "csv" },
	{ from: "yaml", to: "json" },
	{ from: "json", to: "yaml" },
	{ from: "xml", to: "json" },
	{ from: "json", to: "xml" },
	{ from: "feed", to: "json" },
	{ from: "markdown-table", to: "json" },
	{ from: "json", to: "markdown-table" },
	{ from: "html", to: "text" },
] as const satisfies readonly { from: ConvertFormat; to: ConvertFormat }[];

/**
 * The most bytes a Convert node reads by default: 1 MiB, the same cap as
 * the body of a web request. `maxBytes` raises it to `MAX_CONVERT_BYTES`.
 */
export const DEFAULT_CONVERT_MAX_BYTES = 1024 * 1024;
export const MAX_CONVERT_BYTES = 10 * 1024 * 1024;

export const convertNodeSchema = z.object({
	...nodeBase,
	type: z.literal("convert"),
	from: convertFormatSchema,
	to: convertFormatSchema,
	/**
	 * What to convert. Supports templates. From JSON, a template that is one
	 * reference keeps its value (`{{fetch.body}}` stays an object), and text
	 * is read as JSON.
	 */
	value: z.string(),
	/** CSV only: the one character between fields. Unset: reading guesses it, writing uses a comma. */
	delimiter: z.string().length(1).optional(),
	/** The most bytes the value may have. Unset: `DEFAULT_CONVERT_MAX_BYTES`. */
	maxBytes: z.number().int().positive().max(MAX_CONVERT_BYTES).optional(),
	/**
	 * To JSON only: a JSON Schema for `data`. Unset: the format's own shape
	 * (`shapes/convert.ts`): rows of text for CSV, the fixed items of a feed.
	 */
	output: jsonSchemaSchema.optional(),
	/** Night Shift inferred `output` from a real output (`outputInferredSchema`). */
	outputInferred: outputInferredSchema,
});
export type ConvertNode = z.infer<typeof convertNodeSchema>;

/**
 * data: the JSON made, when `to` is JSON (null otherwise or on fail). text:
 * the text made, for any other `to` ("" otherwise). note: why it failed.
 */
export const convertOutputFields = [
	"outcome",
	"data",
	"text",
	"note",
	"visit",
] as const;

/** Whether Night Shift converts `from` to `to`. */
export function canConvert(from: ConvertFormat, to: ConvertFormat): boolean {
	return CONVERT_PAIRS.some((pair) => pair.from === from && pair.to === to);
}

/**
 * A Convert node does one of `CONVERT_PAIRS`, reads a value, and sets the
 * CSV delimiter and an output schema only where they apply.
 */
export function checkConvertNode(node: ConvertNode, check: NodeCheck): void {
	const from = CONVERT_FORMAT_LABEL[node.from];
	const to = CONVERT_FORMAT_LABEL[node.to];
	if (!canConvert(node.from, node.to)) {
		check.error(
			node.from !== "json" && node.to !== "json"
				? `Convert node "${node.id}" cannot convert ${from} to ${to}. Convert ${from} to JSON here, then JSON to ${to} in a second Convert node.`
				: `Convert node "${node.id}" cannot convert ${from} to ${to}. Choose another pair.`,
		);
	}
	if (node.value.trim() === "") {
		check.error(`Convert node "${node.id}" needs a value to convert.`);
	} else {
		check.template(node.value, "value");
	}
	if (
		node.delimiter !== undefined &&
		node.from !== "csv" &&
		node.to !== "csv"
	) {
		check.error(
			`Convert node "${node.id}" sets a delimiter, but only CSV uses one. Remove the delimiter.`,
		);
	}
	if (node.output !== undefined && node.to !== "json") {
		check.error(
			`Convert node "${node.id}" has an output schema, but it makes ${to}, not JSON. Remove the output schema.`,
		);
	}
}

/** A new Convert node: from CSV to JSON, with no value. The issues panel asks for it. */
export function convertNode(id: string, position: Position): ConvertNode {
	return { id, type: "convert", position, from: "csv", to: "json", value: "" };
}

/** The Convert node type. */
export const convertDefinition = {
	type: "convert",
	label: "Convert",
	family: "shape",
	standsIn: true,
	outcomes: () => ["pass", "fail"] satisfies BuiltInOutcome[],
	outcomeColor: noOwnColors,
	outputFields: convertOutputFields,
	check: checkConvertNode,
	texts: [{ at: "value" }],
	plain: ["delimiter"],
	secrets: noSecrets,
	endsFlow: endsOnPass,
	endedLabel: noEndedLabel,
	touchesDevice: () => false,
	// To JSON it has data, to text it has none.
	typedOutputField: (node) => (node.to === "json" ? "data" : null),
	mainOutputField: (node) => (node.to === "json" ? "data" : "text"),
	newNodes: {
		convert: { id: "convert", takes: "value", create: convertNode },
	},
	takeValue: (node, value) => ({ ...node, value: `{{${value.ref}}}` }),
	sample: {
		id: "news",
		type: "convert",
		position: { x: 0, y: 0 },
		from: "feed",
		to: "json",
		value: "{{fetch.body}}",
	},
} satisfies NodeDefinition<ConvertNode, z.input<typeof convertNodeSchema>>;
