import { describe, expect, test } from "bun:test";

import { rerunStarts, resumedStep, runningStep } from "./retry";

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

describe("the step a resume continues at", () => {
	const ran = (
		nodeId: string,
		outcome: string,
		startedAt: number,
		endedAt: number | null = 10,
		nodeType: "agent" | "command" | "decision" = "agent",
	) => ({ nodeId, outcome, startedAt, endedAt, nodeType }) as never;
	const at = (...steps: never[]) =>
		(resumedStep(steps) as { nodeId: string } | undefined)?.nodeId;

	test("the last step that started", () => {
		expect(at(ran("a", "pass", 1), ran("b", "stopped", 2))).toBe("b");
		expect(at(ran("a", "pass", 1, 2), ran("b", "pass", 3, 4))).toBe("b");
		expect(at()).toBeUndefined();
	});

	test("the Agent of another branch, when the last step is done or no Agent", () => {
		const worker = ran("worker", "stopped", 1);
		expect(at(worker, ran("side", "pass", 2, 3, "command"))).toBe("worker");
		expect(at(worker, ran("gate", "stopped", 2, 10, "decision"))).toBe(
			"worker",
		);
		expect(at(worker, ran("two", "stopped", 2))).toBe("two");
	});

	test("not a step that ended before the last one started", () => {
		expect(
			at(ran("old", "stopped", 1, 2), ran("b", "error", 3, 4, "command")),
		).toBe("b");
		expect(at(ran("old", "stopped", 1, 2), ran("b", "pass", 3, 4))).toBe("b");
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
