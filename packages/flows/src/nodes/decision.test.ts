import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, flowSchema } from "../document";
import { withDecidedBy, withValueBy } from "../draft";
import { valueNode } from "../draft/nodes";
import { validateFlow } from "../validate";
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

describe("deadline", () => {
	const flow = (node: DecisionNode) =>
		flowSchema.parse({
			version: FLOW_VERSION,
			inputs: [{ name: "at", type: "text" }],
			start: node.id,
			nodes: [node],
			edges: [],
		});
	const errors = (node: DecisionNode) =>
		validateFlow(flow(node))
			.filter((issue) => issue.severity === "error")
			.map((issue) => issue.message);

	test("is optional, and a flow file of today's version keeps it", () => {
		expect(parse(gate()).deadline).toBeUndefined();
		expect(
			parse(gate({ deadline: { at: "07:00", choose: "reject" } })).deadline,
		).toEqual({ at: "07:00", choose: "reject" });
	});

	test("a Gate with a time or a number of minutes and one of its options is valid", () => {
		expect(
			errors(gate({ deadline: { at: "{{at}}", choose: "reject" } })),
		).toEqual([]);
		expect(
			errors(gate({ deadline: { minutes: 90, choose: "approve" } })),
		).toEqual([]);
	});

	test("chooses one of the Gate's options", () => {
		expect(errors(gate({ deadline: { at: "07:00", choose: "keep" } }))).toEqual(
			[
				'The deadline of Gate "ship" chooses "keep", which is not one of its options. Choose one of: approve, reject.',
			],
		);
	});

	test("has exactly one of a time and a number of minutes", () => {
		const one =
			'The deadline of Gate "ship" needs a time or a number of minutes. Give it one of the two.';
		expect(errors(gate({ deadline: { choose: "reject" } }))).toEqual([one]);
		expect(
			errors(gate({ deadline: { at: "07:00", minutes: 5, choose: "reject" } })),
		).toEqual([one]);
	});

	test("reads known names", () => {
		expect(
			errors(gate({ deadline: { at: "{{ghost}}", choose: "reject" } })),
		).toEqual([
			expect.stringContaining('The deadline of "ship" uses {{ghost}}'),
		]);
	});

	test("belongs to a Gate only", () => {
		expect(
			errors(gate({ by: "model", deadline: { minutes: 5, choose: "reject" } })),
		).toEqual([
			'Decision node "ship" has a deadline, but a model decides it. Only a Gate waits for an answer. Remove the deadline, or let a person decide.',
		]);
	});

	test("goes when a person no longer decides", () => {
		const node = gate({ deadline: { minutes: 5, choose: "reject" } });
		expect("deadline" in withDecidedBy(node, "rule")).toBe(false);
		expect(withDecidedBy(node, "person").deadline).toEqual({
			minutes: 5,
			choose: "reject",
		});
	});
});
