import { describe, expect, test } from "bun:test";

import { rerunStarts, runningStep } from "./retry";

const step = (
	id: string,
	nodeId: string,
	endedAt: number | null = 1,
	nested = false,
) => ({
	id,
	nodeId,
	endedAt,
	scope: nested ? ({ parentStepId: "call", itemId: null } as never) : null,
});

describe("the step a restart starts again", () => {
	test("the innermost step that runs", () => {
		const steps = [
			step("call", "call", null),
			step("a", "a"),
			step("inner", "inner", null, true),
		];
		expect(runningStep(steps)?.id).toBe("inner");
	});

	test("none when every step ended", () => {
		expect(runningStep([step("a", "a"), step("b", "b")])).toBeUndefined();
		expect(runningStep([])).toBeUndefined();
	});
});

describe("where a run runs again from", () => {
	test("the first step and the last, of the run's own steps", () => {
		const starts = rerunStarts([
			step("1", "plan"),
			step("2", "build"),
			step("3", "inner", 1, true),
			step("4", "review"),
		]);
		expect(starts.map((s) => [s.from, s.step.id])).toEqual([
			["start", "1"],
			["last", "4"],
		]);
	});

	test("one place when the first node is the last too", () => {
		const starts = rerunStarts([step("1", "build"), step("2", "build")]);
		expect(starts.map((s) => [s.from, s.step.id])).toEqual([["last", "2"]]);
	});

	test("nothing without own steps", () => {
		expect(rerunStarts([])).toEqual([]);
		expect(rerunStarts([step("3", "inner", 1, true)])).toEqual([]);
	});
});
