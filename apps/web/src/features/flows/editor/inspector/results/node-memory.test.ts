import { describe, expect, test } from "bun:test";

import { memoryOfNode } from "./node-memory";

const entries = [
	{ node: "fresh", scope: "" },
	{ node: "read/fresh", scope: "https://example.com/feed" },
	{ node: "read/inner/fresh", scope: "" },
	{ node: "read_2/fresh", scope: "" },
];

describe("the memory a node's inspector lists", () => {
	test("a Since last run node lists its own memory only", () => {
		expect(
			memoryOfNode(entries, { id: "fresh", type: "since-last-run" }),
		).toEqual([{ node: "fresh", scope: "" }]);
	});

	test("a Subflow node lists what the nodes inside it saw, named by the calling node", () => {
		expect(
			memoryOfNode(entries, {
				id: "read",
				type: "call",
				label: "Read the feed",
			}),
		).toEqual([
			{
				node: "read/fresh",
				scope: "https://example.com/feed",
				inside: "Read the feed › fresh",
			},
			{
				node: "read/inner/fresh",
				scope: "",
				inside: "Read the feed › inner › fresh",
			},
		]);
	});

	test("a Subflow node without a label is named by its id", () => {
		expect(
			memoryOfNode(entries, { id: "read_2", type: "call" }).map(
				(row) => row.inside,
			),
		).toEqual(["read_2 › fresh"]);
	});

	test("another node lists nothing", () => {
		expect(memoryOfNode(entries, { id: "fresh", type: "value" })).toEqual([]);
	});
});
