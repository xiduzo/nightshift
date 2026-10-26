import { describe, expect, test } from "bun:test";
import { newFlow } from "@nightshift/flows";
import { isBlankFlow } from "./starters";

describe("isBlankFlow", () => {
	test("a new flow is blank, a flow with an edge is not", () => {
		const flow = newFlow();
		expect(isBlankFlow(flow)).toBe(true);
		expect(isBlankFlow({ nodes: [], edges: [] })).toBe(true);
		const node = flow.nodes[0];
		if (!node) throw new Error("newFlow has a node");
		expect(
			isBlankFlow({
				nodes: [node, { ...node, id: "two" }],
				edges: [{ id: "e1", from: node.id, outcome: "pass", to: "two" }],
			}),
		).toBe(false);
	});
});
