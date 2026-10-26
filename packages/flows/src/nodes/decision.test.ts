import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, flowSchema } from "../document";
import { withDecidedBy, withValueBy } from "../draft";
import { valueNode } from "../draft/nodes";
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

describe("decider", () => {
	test("a model starts on the decider from Settings, else TypeSafe", () => {
		expect(withDecidedBy(gate(), "model").decider).toBe("typesafe");
		expect(
			withDecidedBy(gate(), "model", { decisionDecider: "ollaya" }).decider,
		).toBe("ollaya");
	});

	test("goes with its model when a model no longer decides", () => {
		const node = gate({ by: "model", decider: "openai", model: "m" });
		for (const by of ["person", "rule"] as const) {
			const next = withDecidedBy(node, by);
			expect("decider" in next || "model" in next).toBe(false);
		}
	});

	test("a Value by a rule has none; by a model, one that can make a value", () => {
		const rule = valueNode("shape", { x: 0, y: 0 });
		expect("decider" in rule).toBe(false);
		const model = withValueBy(rule, "model");
		expect(model.decider).toBe("openrouter");
		expect(
			withValueBy({ ...model, decider: "typesafe" }, "rule"),
		).not.toHaveProperty("decider");
		expect(withValueBy({ ...rule, decider: "typesafe" }, "model").decider).toBe(
			"openrouter",
		);
	});
});
