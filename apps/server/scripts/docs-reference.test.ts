import { describe, expect, test } from "bun:test";
import { cell, fill, firstColumnNames, table } from "./docs-reference";

const generated = { kits: () => table(["Kit"], [["`kit:a`"]]) };
const checked = { nodes: () => ["Agent", "Wait"] };

describe("fill", () => {
	test("writes a generated block and keeps its markers", () => {
		const text = [
			"Before.",
			"<!-- generated:kits: do not edit. -->",
			"old",
			"<!-- /generated:kits -->",
			"After.",
		].join("\n");
		const { text: filled, problems } = fill(text, generated, checked);
		expect(problems).toEqual([]);
		expect(filled).toBe(
			[
				"Before.",
				"<!-- generated:kits: do not edit. -->",
				"| Kit |",
				"| --- |",
				"| `kit:a` |",
				"<!-- /generated:kits -->",
				"After.",
			].join("\n"),
		);
	});

	test("fills an empty generated block", () => {
		const text = "<!-- generated:kits -->\n<!-- /generated:kits -->";
		const { text: filled } = fill(text, generated, checked);
		expect(filled).toBe(
			"<!-- generated:kits -->\n| Kit |\n| --- |\n| `kit:a` |\n<!-- /generated:kits -->",
		);
	});

	test("leaves a checked table as it is, and names what it misses and adds", () => {
		const text = [
			"<!-- checked:nodes -->",
			"| Node | Does |",
			"| --- | --- |",
			"| **Agent** | Works. |",
			"| **Lease** | Waits. |",
			"<!-- /checked:nodes -->",
		].join("\n");
		const { text: filled, problems } = fill(text, generated, checked);
		expect(filled).toBe(text);
		expect(problems).toEqual([
			{ block: "checked:nodes", message: "misses Wait." },
			{
				block: "checked:nodes",
				message: "names Lease, which the code does not have.",
			},
		]);
	});

	test("names a block without a generator", () => {
		const text = "<!-- generated:nope -->\nx\n<!-- /generated:nope -->";
		const { text: filled, problems } = fill(text, generated, checked);
		expect(filled).toBe(text);
		expect(problems).toEqual([
			{ block: "generated:nope", message: "has no generator. Check its name." },
		]);
	});
});

describe("firstColumnNames", () => {
	test("reads every code or bold name of the first cell, after the header", () => {
		const body = [
			"| Tool | Does |",
			"| --- | --- |",
			"| `list_flows`, `get_flow` | Read. A `pipe` here does not count. |",
			"| **Gate** \\| person | Waits. |",
		].join("\n");
		expect(firstColumnNames(body)).toEqual(["list_flows", "get_flow", "Gate"]);
	});
});

describe("cell", () => {
	test("keeps a table cell on one line and escapes a pipe", () => {
		expect(cell("a | b\nc  d")).toBe("a \\| b c d");
	});
});
