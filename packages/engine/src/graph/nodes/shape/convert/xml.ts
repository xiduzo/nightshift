import type { JsonValue } from "@nightshift/flows";
import { XMLBuilder, XMLParser, XMLValidator } from "fast-xml-parser";
import { ConvertProblem } from "./problem";

/**
 * XML with fast-xml-parser. An element becomes a record, an attribute a
 * key `@name`, the text of an element with attributes `#text`, and an
 * element that repeats a list. Every value stays text: "007" is not 7.
 * Writing takes the same shape back. The parser's own limits on entities
 * hold, so an entity cannot grow the value without end.
 */

const SHAPE = {
	ignoreAttributes: false,
	attributeNamePrefix: "@",
	textNodeName: "#text",
} as const;

const parser = new XMLParser({
	...SHAPE,
	parseTagValue: false,
	parseAttributeValue: false,
	ignoreDeclaration: true,
	ignorePiTags: true,
});

const builder = new XMLBuilder({ ...SHAPE, format: true });

export function readXml(text: string): JsonValue {
	const valid = XMLValidator.validate(text);
	if (valid !== true) {
		throw new ConvertProblem(
			`The XML is not valid on line ${valid.err.line}: ${valid.err.msg}`,
		);
	}
	return parser.parse(text) as JsonValue;
}

export function writeXml(value: JsonValue): string {
	const roots =
		typeof value === "object" && value !== null && !Array.isArray(value)
			? Object.keys(value)
			: [];
	if (roots.length !== 1) {
		throw new ConvertProblem(
			'XML needs one root element: a record with one key, such as {"note": {"to": "Ann", "@lang": "en"}}.',
		);
	}
	return builder.build(value) as string;
}
