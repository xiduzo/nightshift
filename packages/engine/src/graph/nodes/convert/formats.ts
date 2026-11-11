import type { ConvertNode, JsonValue } from "@nightshift/flows";
import { readCsv, writeCsv } from "./csv";
import { readFeed } from "./feed";
import { htmlToText } from "./html";
import { readMarkdownTable, writeMarkdownTable } from "./markdown-table";
import { ConvertProblem } from "./problem";
import { readXml, writeXml } from "./xml";
import { readYaml, writeYaml } from "./yaml";

/** What a conversion made: JSON for `data`, or text for `text`. */
export type Converted =
	| { kind: "data"; data: JsonValue }
	| { kind: "text"; text: string };

/**
 * Converts the node's rendered value. From JSON it takes the JSON value;
 * else the text. Throws `ConvertProblem` when the value does not fit the
 * format, and for a pair the flow check refuses.
 */
export function convertValue(
	node: Pick<ConvertNode, "from" | "to" | "delimiter">,
	value: { json: JsonValue } | { text: string },
): Converted {
	if ("json" in value) {
		return { kind: "text", text: writeText(node, value.json) };
	}
	return readText(node, value.text);
}

/** JSON written as the text of the node's `to` format. */
function writeText(
	{ from, to, delimiter }: Pick<ConvertNode, "from" | "to" | "delimiter">,
	json: JsonValue,
): string {
	switch (to) {
		case "csv":
			return writeCsv(json, delimiter);
		case "yaml":
			return writeYaml(json);
		case "xml":
			return writeXml(json);
		case "markdown-table":
			return writeMarkdownTable(json);
		default:
			throw new ConvertProblem(`Night Shift cannot convert ${from} to ${to}.`);
	}
}

/** Text of the node's `from` format, read into JSON, or HTML into text. */
function readText(
	{ from, to, delimiter }: Pick<ConvertNode, "from" | "to" | "delimiter">,
	text: string,
): Converted {
	if (from === "html" && to === "text") {
		return { kind: "text", text: htmlToText(text) };
	}
	if (to === "json") {
		switch (from) {
			case "csv":
				return { kind: "data", data: readCsv(text, delimiter) };
			case "yaml":
				return { kind: "data", data: readYaml(text) };
			case "xml":
				return { kind: "data", data: readXml(text) };
			case "feed":
				return { kind: "data", data: readFeed(text) };
			case "markdown-table":
				return { kind: "data", data: readMarkdownTable(text) };
		}
	}
	throw new ConvertProblem(`Night Shift cannot convert ${from} to ${to}.`);
}
