import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, flowSchema } from "../document";
import { withDecidedBy } from "../draft";
import type { DecisionNode } from "./decision";

/** The Decision node's lock-screen flag: a Gate the author lets a person answer from a phone's lock screen. */

function gate(extra: Partial<DecisionNode> = {}): DecisionNode {
	return {
		id: "ship",
		type: "decision",
		position: { x: 0, y: 0 },
		prompt: "Ship it?",
		options: [{ name: "approve" }, { name: "reject" }],
		by: "person",
		decider: "typesafe",
		...extra,
	};
}

function parse(node: Record<string, unknown>) {
	return flowSchema.parse({
		version: FLOW_VERSION,
		start: "ship",
		nodes: [node],
		edges: [],
	}).nodes[0] as DecisionNode;
}

describe("lockScreen", () => {
	test("is optional: a Gate without it reads as not answered from the lock screen", () => {
		const { lockScreen: _, ...node } = gate();
		expect(parse(node).lockScreen).toBeUndefined();
	});

	test("a flow file of today's version keeps it", () => {
		expect(parse(gate({ lockScreen: true })).lockScreen).toBe(true);
	});

	test("must be a boolean", () => {
		expect(() => parse({ ...gate(), lockScreen: "yes" })).toThrow();
	});

	test("goes when a person no longer decides, and stays while one does", () => {
		const node = gate({ lockScreen: true });
		expect("lockScreen" in withDecidedBy(node, "rule")).toBe(false);
		expect("lockScreen" in withDecidedBy(node, "model")).toBe(false);
		expect(withDecidedBy(node, "person").lockScreen).toBe(true);
	});
});
