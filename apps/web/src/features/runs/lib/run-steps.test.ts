import { describe, expect, test } from "bun:test";
import type { StepSummary } from "@nightshift/client";
import { climbOf } from "./run-steps";

/** A step of `triage` with its outcome and tier: only what a climb reads. */
const visit = (
	id: string,
	outcome: string | null,
	outputs: Record<string, unknown> = {},
	nodeId = "triage",
): StepSummary =>
	({ id, nodeId, outcome, outputs, scope: null }) as unknown as StepSummary;

describe("climbOf", () => {
	const steps = [
		visit("a", "fail", { tier: "local", confidence: 0.4 }),
		visit("b", "fail", { tier: "local", confidence: 0.5 }),
		visit("c", "bug", { tier: "strong", confidence: 0.9 }),
		visit("x", "pass", {}, "after"),
		visit("d", "bug", { tier: "local", confidence: 0.95 }),
	];

	test("the tries of one climb, with their tier, their try in the tier and their confidence", () => {
		const climb = climbOf(steps, steps[1] as StepSummary);
		expect(climb.map((t) => [t.step.id, t.tier, t.try, t.confidence])).toEqual([
			["a", "local", 1, 0.4],
			["b", "local", 2, 0.5],
			["c", "strong", 1, 0.9],
		]);
	});

	test("a later visit that held at once is a climb of its own, and a step without a tier has none", () => {
		expect(
			climbOf(steps, steps[4] as StepSummary).map((t) => t.step.id),
		).toEqual(["d"]);
		expect(climbOf(steps, steps[3] as StepSummary)).toEqual([]);
	});
});
