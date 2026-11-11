import { describe, expect, test } from "bun:test";
import { withDecidedBy, withValueBy } from "../draft";
import { FLOW_VERSION, flowSchema } from "../flow";
import { validateFlow } from "../validate";
import type { DecisionNode } from "./decision";
import type { ValueNode } from "./value";

/** The brief of a Gate (ADR 21): urgency, situation, background, recommendation, impacts. */

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

function ask(extra: Partial<ValueNode> = {}): ValueNode {
	return {
		id: "ship",
		type: "value",
		position: { x: 0, y: 0 },
		by: "person",
		prompt: "Which version?",
		output: { type: "object", properties: { version: { type: "string" } } },
		...extra,
	};
}

function errors(node: DecisionNode | ValueNode): string[] {
	const parsed = flowSchema.parse({
		version: FLOW_VERSION,
		inputs: [{ name: "level", type: "text" }],
		start: node.id,
		nodes: [node],
		edges: [],
	});
	return validateFlow(parsed)
		.filter((issue) => issue.severity === "error")
		.map((issue) => issue.message);
}

describe("the brief of a Decision", () => {
	test("is optional, and a flow file of today's version keeps it", () => {
		const node = gate({
			urgency: "now",
			situation: "The tests are red.",
			background: "- The build passed (source: CI)",
			recommend: { option: "reject", reason: "Red tests." },
			fillBrief: false,
			options: [
				{ name: "approve", impact: "It ships tonight." },
				{ name: "reject" },
			],
		});
		const parsed = flowSchema.parse({
			version: FLOW_VERSION,
			start: "ship",
			nodes: [node],
			edges: [],
		}).nodes[0] as DecisionNode;
		expect(parsed).toEqual(node);
		expect(errors(node)).toEqual([]);
	});

	test("an urgency is now, today or later, or a template", () => {
		expect(errors(gate({ urgency: "later" }))).toEqual([]);
		expect(errors(gate({ urgency: "{{level}}" }))).toEqual([]);
		expect(errors(gate({ urgency: "soon" }))).toEqual([
			'Decision node "ship" has the urgency "soon". Use one of: now, today, later.',
		]);
	});

	test("a recommendation names one of the options", () => {
		expect(errors(gate({ recommend: { option: "{{level}}" } }))).toEqual([]);
		expect(errors(gate({ recommend: { option: "merge" } }))).toEqual([
			'Decision node "ship" recommends "merge", which is not one of its options. Choose one of: approve, reject.',
		]);
	});

	test("its templates read known names", () => {
		expect(errors(gate({ situation: "{{ghost}}" }))).toEqual([
			expect.stringContaining("{{ghost}}"),
		]);
		expect(
			errors(
				gate({
					options: [{ name: "approve", impact: "{{ghost}}" }, { name: "no" }],
				}),
			),
		).toEqual([expect.stringContaining("{{ghost}}")]);
	});

	test("belongs to a Gate only", () => {
		expect(
			errors(
				gate({
					by: "rule",
					urgency: "now",
					situation: "Why",
					options: [{ name: "approve", when: "true" }, { name: "reject" }],
				}),
			),
		).toEqual([
			'Decision node "ship" sets urgency, situation, but a person does not answer it. Only a person reads the brief. Remove them, or let a person decide.',
		]);
		expect(
			errors(
				gate({
					by: "model",
					options: [{ name: "approve", impact: "Ships." }, { name: "reject" }],
				}),
			),
		).toEqual([
			'Decision node "ship" gives an impact on the option "approve", but a person does not answer it. Only a person reads the impact. Remove it, or let a person decide.',
		]);
	});

	test("the person tier of a cascade takes the brief and the impacts", () => {
		const node = gate({
			by: "model",
			options: [{ name: "approve", impact: "Ships." }, { name: "reject" }],
			cascade: [
				{ decider: "openrouter" },
				{
					person: true,
					urgency: "now",
					recommend: { option: "approve" },
				},
			],
		});
		expect(errors(node)).toEqual([]);
		expect(
			errors({
				...node,
				cascade: [
					{ decider: "openrouter" },
					{ person: true, urgency: "asap", recommend: { option: "merge" } },
				],
			}),
		).toEqual([
			'The person tier of "ship" has the urgency "asap". Use one of: now, today, later.',
			'The person tier of "ship" recommends "merge", which is not one of its options. Choose one of: approve, reject.',
		]);
	});

	test("goes when a person no longer decides", () => {
		const node = gate({
			urgency: "now",
			situation: "Why",
			recommend: { option: "approve" },
			options: [{ name: "approve", impact: "Ships." }, { name: "reject" }],
		});
		const ruled = withDecidedBy(node, "rule");
		expect("urgency" in ruled || "situation" in ruled).toBe(false);
		expect(ruled.options).toEqual([{ name: "approve" }, { name: "reject" }]);
		expect(withDecidedBy(ruled, "person").options).toEqual(ruled.options);
	});
});

describe("the brief of an Ask", () => {
	test("takes urgency, situation and background", () => {
		expect(
			errors(ask({ urgency: "today", situation: "Why", background: "Done" })),
		).toEqual([]);
	});

	test("belongs to a person only", () => {
		expect(
			errors(ask({ by: "model", decider: "openrouter", situation: "Why" })),
		).toEqual([
			'Value node "ship" sets situation, but a person does not answer it. Only a person reads the brief. Remove it, or let a person make it.',
		]);
	});

	test("a switch away from a person drops it", () => {
		const node = withValueBy(ask({ urgency: "now" }), "rule");
		expect("urgency" in node).toBe(false);
	});
});
