import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type FlowNode, flowSchema } from "@nightshift/flows";
import { GIST_MAX, gist, sampleLine, shapeLabel } from "./gist";

describe("the gist of a value", () => {
	test("a text gives its first line with words on it", () => {
		expect(gist("\n  Three new posts today\nand more")).toBe(
			"Three new posts today",
		);
		expect(gist("   \n ")).toBeNull();
		expect(gist("")).toBeNull();
	});

	test("a log gives its last line", () => {
		expect(gist("fetching\n12 rows written\n\n", { lastLine: true })).toBe(
			"12 rows written",
		);
	});

	test("a long text is cut, and only its start is read", () => {
		const long = "a".repeat(64 * 1024);
		const line = gist(long) ?? "";
		expect(line.length).toBe(GIST_MAX);
		expect(line.endsWith("…")).toBe(true);
		expect(gist(`${"b".repeat(10)}\n${long}`)).toBe("bbbbbbbbbb");
	});

	test("a number, yes or no, and nothing", () => {
		expect(gist(12.5)).toBe("12.5");
		expect(gist(0)).toBe("0");
		expect(gist(true)).toBe("Yes");
		expect(gist(false)).toBe("No");
		expect(gist(null)).toBeNull();
		expect(gist(undefined)).toBeNull();
	});

	test("a list gives its count and its first item", () => {
		expect(gist([])).toBe("No items");
		expect(gist(["Berlin", "Paris"])).toBe("2 items · first: Berlin");
		expect(gist([42])).toBe("1 item · first: 42");
		expect(
			gist([
				{ id: 7, title: "Price drop on the blue chair", url: "https://x" },
				{ id: 8 },
			]),
		).toBe("2 items · first: Price drop on the blue chair");
		expect(gist([{ score: 3, note: "ok" }])).toBe(
			"1 item · first: 2 fields: score, note",
		);
		expect(gist([[1, 2], [3]])).toBe("2 items · first: 2 items");
		expect(gist([null])).toBe("1 item");
	});

	test("a record names its fields", () => {
		expect(gist({})).toBe("No fields");
		expect(gist({ status: 200 })).toBe("1 field: status");
		expect(gist({ a: 1, b: 2, c: 3, d: 4 })).toBe("4 fields: a, b, c, …");
	});

	test("a list or record keeps its gist", () => {
		const value = { a: 1 };
		expect(gist(value)).toBe("1 field: a");
		(value as Record<string, number>).b = 2;
		expect(gist(value)).toBe("1 field: a");
	});

	test("a file gives its name", () => {
		const shape = { type: "string", format: "file" };
		expect(gist("reports/2026-11-12/summary.md", { shape })).toBe("summary.md");
		expect(gist("summary.md\n", { shape })).toBe("summary.md");
	});
});

const nodes = flowSchema.parse({
	version: FLOW_VERSION,
	start: "fetch",
	nodes: [
		{
			id: "fetch",
			type: "command",
			position: { x: 0, y: 0 },
			command: "curl -s https://example.com/feed",
			stdout: "text",
		},
		{
			id: "read",
			type: "web-request",
			position: { x: 0, y: 0 },
			method: "GET",
			url: "https://example.com/api",
		},
	],
	edges: [],
}).nodes;
const fetch = nodes[0] as FlowNode;
const read = nodes[1] as FlowNode;

describe("the viewer line of a node", () => {
	const ended = { endedAt: 10, outcome: "pass" };

	test("a node the runs did not reach, and a node that runs", () => {
		expect(sampleLine(fetch, undefined)).toEqual({ kind: "absent" });
		expect(
			sampleLine(fetch, { endedAt: null, outcome: null, outputs: {} }),
		).toEqual({ kind: "running" });
	});

	test("the gist of the node's main output", () => {
		expect(
			sampleLine(fetch, {
				...ended,
				outputs: { log_tail: "start\n3 new items", exit_code: 0 },
			}),
		).toEqual({ kind: "output", text: "3 new items", field: "log_tail" });
		expect(
			sampleLine(read, {
				...ended,
				outputs: { status: 200, body: { items: [], next: null } },
			}),
		).toEqual({ kind: "output", text: "2 fields: items, next", field: "body" });
	});

	test("a step that gave nothing there shows its outcome", () => {
		expect(
			sampleLine(fetch, { endedAt: 10, outcome: "error", outputs: {} }),
		).toEqual({ kind: "output", text: "Error", field: "log_tail" });
		expect(
			sampleLine(fetch, { endedAt: 10, outcome: null, outputs: {} }),
		).toEqual({ kind: "output", text: "No output", field: "log_tail" });
	});
});

describe("the shape of an output field, as a word", () => {
	test("the field's shape says it", () => {
		expect(shapeLabel([], { type: "array" })).toBe("List");
		expect(shapeLabel("a.md", { type: "string", format: "file" })).toBe("File");
		expect(shapeLabel(200, { type: "integer" })).toBe("Whole number");
	});

	test("else the value says it", () => {
		expect(shapeLabel({ a: 1 }, {})).toBe("Record");
		expect(shapeLabel(1.5, undefined)).toBe("Number");
		expect(shapeLabel(true, {})).toBe("Yes or no");
		expect(shapeLabel(null, {})).toBeNull();
	});
});
