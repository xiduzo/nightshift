import type { ConvertFormat, ConvertNode } from "../nodes";

/**
 * The shape of a Convert node's `data`, per format it reads. The engine
 * makes data of exactly this shape (its tests check it), so a later node's
 * template path is checked against it. A node's own `output` schema wins
 * (`outputFieldShape`).
 */

type Schema = Record<string, unknown>;

const text: Schema = { type: "string" };
const texts: Schema = { type: "array", items: text };

/** Rows of a table: one record per row, a text per column. */
const ROWS: Schema = {
	type: "array",
	items: { type: "object", additionalProperties: text },
};

/**
 * The fields of one item of a feed, the same for RSS, Atom, RDF and JSON
 * Feed. Each is text ("" when the feed leaves it out), apart from the lists
 * of authors and categories. `id` is the feed's own id of the item, else its
 * link, else its title. `published` and `updated` are ISO 8601 when the
 * feed's date reads as one.
 */
const FEED_ITEM_FIELDS = {
	id: text,
	title: text,
	link: text,
	summary: text,
	content: text,
	published: text,
	updated: text,
	authors: texts,
	categories: texts,
} as const;

/** The keys of a feed item, in order. */
export const FEED_ITEM_KEYS = Object.keys(
	FEED_ITEM_FIELDS,
) as readonly (keyof typeof FEED_ITEM_FIELDS)[];

const FEED_ITEM_SHAPE: Schema = {
	type: "object",
	properties: FEED_ITEM_FIELDS,
	required: [...FEED_ITEM_KEYS],
};

/** A whole feed: which kind it was, its title, link and description, and its items. */
const FEED_SHAPE: Schema = {
	type: "object",
	properties: {
		format: { type: "string", enum: ["rss", "atom", "rdf", "json"] },
		title: text,
		link: text,
		description: text,
		items: { type: "array", items: FEED_ITEM_SHAPE },
	},
	required: ["format", "title", "link", "description", "items"],
};

/**
 * The data each format reads into. YAML can hold any value. XML is one
 * record per element: attributes as `@name`, an element's own text as
 * `#text` when it has attributes, a repeated element as a list.
 */
const DATA_SHAPES: Record<Exclude<ConvertFormat, "json">, Schema> = {
	csv: ROWS,
	yaml: {},
	xml: { type: "object" },
	feed: FEED_SHAPE,
	"markdown-table": ROWS,
	html: { type: "null" },
	text: { type: "null" },
};

/** The shape of a Convert node's `data`: its format's shape to JSON, else null. */
export function convertDataShape(
	node: Pick<ConvertNode, "from" | "to">,
): Schema {
	if (node.to !== "json" || node.from === "json") return { type: "null" };
	return DATA_SHAPES[node.from];
}
