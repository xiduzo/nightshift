import { describe, expect, test } from "bun:test";
import type { DataLink } from "@nightshift/flows";
import { isDataEdgeId, selectedDataPairs } from "./data-links";

const links: DataLink[] = [
	{ from: "scout", to: "pick", refs: ["data.items"] },
	{ from: "pick", to: "write", refs: ["data.choice", "outcome"] },
	{ from: "scout", to: "write", refs: ["data.items"] },
	{ from: "plan", to: "write", refs: ["data.outline", "data.items"] },
	{ from: "plan", to: "draft", refs: ["data.outline"] },
];
const itself = (id: string) => id;

describe("selectedDataPairs", () => {
	test("only the links into and out of the selected node", () => {
		expect(selectedDataPairs(links, "pick", itself)).toEqual([
			{ source: "scout", target: "pick", refs: ["data.items"] },
			{ source: "pick", target: "write", refs: ["data.choice", "outcome"] },
		]);
	});

	test("a node in a folded Section is its box: links to one box are one line, links inside it go", () => {
		const box = (id: string) =>
			id === "plan" || id === "scout" || id === "draft" ? "section:prep" : id;
		expect(selectedDataPairs(links, "write", box)).toEqual([
			{
				source: "pick",
				target: "write",
				refs: ["data.choice", "outcome"],
			},
			{
				source: "section:prep",
				target: "write",
				refs: ["data.items", "data.outline"],
			},
		]);
		expect(selectedDataPairs(links, "plan", box)).toEqual([
			{
				source: "section:prep",
				target: "write",
				refs: ["data.outline", "data.items"],
			},
		]);
	});
});

test("a dotted line's id is never an edge of the flow", () => {
	expect(isDataEdgeId("data:scout>pick")).toBe(true);
	expect(isDataEdgeId("e1")).toBe(false);
});
