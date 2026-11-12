import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import { outputFieldShape, typedOutput } from "../shapes/fields";
import { validateFlow } from "../validate";
import type { CommandNode } from "./command";
import {
	CONVERT_PAIRS,
	type ConvertNode,
	canConvert,
	MAX_CONVERT_BYTES,
} from "./convert";

/** The Convert node: text of a format to JSON and back, and HTML to text. */

function convert(id: string, extra: Partial<ConvertNode> = {}): ConvertNode {
	return {
		id,
		type: "convert",
		position: { x: 0, y: 0 },
		from: "csv",
		to: "json",
		value: "{{export.log_tail}}",
		...extra,
	};
}

function command(id: string): CommandNode {
	return {
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: "true",
		stdout: "text",
	};
}

function flowOf(nodes: Flow["nodes"], edges: Flow["edges"] = []): Flow {
	return {
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges,
	};
}

/** The messages of `flow`'s issues on `nodeId`, as `severity: message`. */
function issuesOf(flow: Flow, nodeId: string): string[] {
	return validateFlow(flow)
		.filter((issue) => issue.nodeId === nodeId)
		.map((issue) => `${issue.severity}: ${issue.message}`);
}

describe("the Convert node schema", () => {
	test("parses its pair and value", () => {
		const parsed = flowSchema.parse({
			version: FLOW_VERSION,
			start: "rows",
			nodes: [
				{
					id: "rows",
					type: "convert",
					position: { x: 0, y: 0 },
					from: "csv",
					to: "json",
					value: "{{export.log_tail}}",
				},
			],
			edges: [],
		});
		expect(parsed.nodes[0]).toEqual(convert("rows"));
	});

	test("refuses an unknown format, a long delimiter and too many bytes", () => {
		const parses = (node: Record<string, unknown>) =>
			flowSchema.safeParse({
				version: FLOW_VERSION,
				start: "rows",
				nodes: [{ ...convert("rows"), ...node }],
				edges: [],
			}).success;
		expect(parses({ from: "toml" })).toBe(false);
		expect(parses({ delimiter: ";;" })).toBe(false);
		expect(parses({ maxBytes: MAX_CONVERT_BYTES + 1 })).toBe(false);
		expect(parses({ delimiter: ";", maxBytes: MAX_CONVERT_BYTES })).toBe(true);
	});

	test("one side of every pair is JSON, apart from HTML to text", () => {
		for (const pair of CONVERT_PAIRS) {
			const html = pair.from === "html" && pair.to === "text";
			expect(html || (pair.from === "json") !== (pair.to === "json")).toBe(
				true,
			);
		}
		expect(canConvert("csv", "json")).toBe(true);
		expect(canConvert("csv", "yaml")).toBe(false);
		expect(canConvert("json", "feed")).toBe(false);
	});
});

describe("validateFlow: Convert", () => {
	test("a Convert node that reads an earlier node has no issues", () => {
		const flow = flowOf(
			[command("export"), convert("rows"), command("report")],
			[
				{ id: "e1", from: "export", outcome: "pass", to: "rows" },
				{ id: "e2", from: "rows", outcome: "pass", to: "report" },
			],
		);
		expect(issuesOf(flow, "rows")).toEqual([]);
	});

	test("a pair without JSON on one side is an error that says how to do it", () => {
		const flow = flowOf([
			command("export"),
			convert("rows", { from: "csv", to: "yaml" }),
		]);
		expect(issuesOf(flow, "rows")).toContain(
			'error: Convert node "rows" cannot convert CSV to YAML. Convert CSV to JSON here, then JSON to YAML in a second Convert node.',
		);
		const feed = flowOf([
			command("export"),
			convert("rows", { from: "json", to: "feed" }),
		]);
		expect(issuesOf(feed, "rows")).toContain(
			'error: Convert node "rows" cannot convert JSON to RSS or Atom feed. Choose another pair.',
		);
	});

	test("an empty value, an unknown reference, a stray delimiter and output are errors", () => {
		expect(issuesOf(flowOf([convert("rows", { value: " " })]), "rows")).toEqual(
			['error: Convert node "rows" needs a value to convert.'],
		);
		expect(
			issuesOf(flowOf([convert("rows", { value: "{{ghost.text}}" })]), "rows"),
		).toEqual([
			'error: The value of "rows" uses {{ghost.text}}, but there is no node or input "ghost".',
		]);
		const html = convert("rows", {
			from: "html",
			to: "text",
			value: "<p>Hi</p>",
			delimiter: ";",
			output: { type: "object" },
		});
		expect(issuesOf(flowOf([html]), "rows")).toEqual([
			'error: Convert node "rows" sets a delimiter, but only CSV uses one. Remove the delimiter.',
			'error: Convert node "rows" has an output schema, but it makes Text, not JSON. Remove the output schema.',
		]);
	});

	test("a later node reads a feed item's fields, and a field a feed lacks warns", () => {
		const flow = flowOf(
			[
				command("fetch"),
				convert("news", { from: "feed", value: "{{fetch.log_tail}}" }),
				{
					...command("report"),
					command: 'echo "{{news.data.items}} {{news.data.title}}"',
				},
				{ ...command("typo"), command: 'echo "{{news.data.entries}}"' },
			],
			[
				{ id: "e1", from: "fetch", outcome: "pass", to: "news" },
				{ id: "e2", from: "news", outcome: "pass", to: "report" },
				{ id: "e3", from: "report", outcome: "pass", to: "typo" },
			],
		);
		expect(issuesOf(flow, "report")).toEqual([]);
		expect(issuesOf(flow, "typo")).toEqual([
			'warning: The command of "typo" uses {{news.data.entries}}, but news.data has no field "entries". Use one of: format, title, link, description, items.',
		]);
	});
});

describe("the shape of a Convert node's data", () => {
	test("is the format's shape to JSON, null to text, and its own output when set", () => {
		const rows = convertShape({ from: "csv" });
		expect(rows).toEqual({
			type: "array",
			items: { type: "object", additionalProperties: { type: "string" } },
		});
		expect(convertShape({ from: "yaml" })).toEqual({});
		expect(convertShape({ from: "json", to: "csv" })).toEqual({
			type: "null",
		});
		expect(convertShape({ from: "html", to: "text" })).toEqual({
			type: "null",
		});
		const output = { type: "array", items: { type: "object" } };
		expect(convertShape({ output })).toBe(output);
		expect(outputFieldShape(convert("rows"), "text")).toEqual({
			type: "string",
		});
	});
});

describe("the schema a Convert node holds its data to", () => {
	test("is its own output, else its format's shape, which counts as written; to text it has none", () => {
		expect(typedOutput(convert("rows"))).toEqual({
			field: "data",
			schema: convertShape({}),
			inferred: false,
		});
		const output = { type: "array", items: { type: "object" } };
		expect(
			typedOutput(convert("rows", { output, outputInferred: true })),
		).toEqual({ field: "data", schema: output, inferred: true });
		expect(
			typedOutput(convert("rows", { from: "html", to: "text" })),
		).toBeNull();
	});
});

function convertShape(extra: Partial<ConvertNode>) {
	return outputFieldShape(convert("rows", extra), "data");
}
