import { describe, expect, test } from "bun:test";
import type { AgentNode, DecisionNode, ValueNode } from "@nightshift/flows";
import { agent, command } from "../testing/graph";
import { stepRung } from "./cascade";

/** The rung a new step names (`StepStarted.rung`), from its node and its place on the cascade. */

const at = { x: 0, y: 0 };

const decision = (extra: Partial<DecisionNode>): DecisionNode => ({
	id: "triage",
	type: "decision",
	position: at,
	prompt: "Bug or feature?",
	options: [{ name: "bug" }, { name: "feature" }],
	by: "rule",
	...extra,
});

const value = (by: ValueNode["by"]): ValueNode => ({
	id: "plan",
	type: "value",
	position: at,
	by,
	output: { type: "object" },
});

const worker: AgentNode = {
	...agent("worker", "Find leads."),
	cascade: [
		{ label: "small", model: "sonnet", harness: "claude-code", tries: 2 },
		{ label: "big", model: "opus", harness: "claude-code" },
		{ person: true },
	],
};

const position = (tier: number, attempt: number) => ({
	cascades: { worker: { tier, try: attempt, trail: [] } },
});

describe("stepRung", () => {
	test("a try of a cascade names its tier and who tries it; the person tier is last", () => {
		expect(stepRung(worker, {})).toEqual({ by: "agent", tier: 0 });
		expect(stepRung(worker, position(0, 2))).toEqual({ by: "agent", tier: 0 });
		expect(stepRung(worker, position(1, 1))).toEqual({ by: "agent", tier: 1 });
		expect(stepRung(worker, position(2, 1))).toEqual({
			by: "person",
			tier: 2,
			last: true,
		});
		// One more try on the last model tier, after a person chose try-again.
		expect(stepRung(worker, position(1, 2))).toEqual({ by: "agent", tier: 1 });
	});

	test("the last model tier of a cascade without a person is last", () => {
		const { cascade, ...plain } = worker;
		const twoTiers = { ...plain, cascade: cascade?.slice(0, 2) };
		expect(stepRung(twoTiers, position(1, 1))).toEqual({
			by: "agent",
			tier: 1,
			last: true,
		});
	});

	test("a node without a cascade has one rung: its decider, its rule, a person, an agent or its flow", () => {
		expect(stepRung(decision({ by: "rule" }), {})).toEqual({
			by: "rule",
			last: true,
		});
		expect(stepRung(decision({ by: "model" }), {})).toEqual({
			by: "model",
			last: true,
		});
		expect(stepRung(decision({ by: "person" }), {})).toEqual({
			by: "person",
			last: true,
		});
		expect(stepRung(value("model"), {})).toEqual({ by: "model", last: true });
		expect(stepRung(value("person"), {})).toEqual({ by: "person", last: true });
		expect(stepRung(agent("worker", "Go."), {})).toEqual({
			by: "agent",
			last: true,
		});
		expect(
			stepRung(
				{ id: "sub", type: "call", position: at, flow: "other", inputs: {} },
				{},
			),
		).toEqual({ by: "flow", last: true });
	});

	test("a Value by rule and a Command are on no ladder", () => {
		expect(stepRung(value("rule"), {})).toBeNull();
		expect(stepRung(command("check", "true"), {})).toBeNull();
	});
});
