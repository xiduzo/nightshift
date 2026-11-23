import { describe, expect, test } from "bun:test";
import {
	changedRuns,
	endedRuns,
	factsBySpace,
	type NotifierFact,
} from "./facts";

const base = { spaceId: "space-1", runId: "run-1", seq: 1 };

describe("the rules of one landing", () => {
	test("groups the facts by Space, in their order", () => {
		const facts: NotifierFact[] = [
			{ ...base, changes: "summary", kind: "other" },
			{ ...base, spaceId: "space-2", changes: "summary", kind: "other" },
			{ ...base, seq: 2, changes: "detail", kind: "other" },
		];
		const bySpace = factsBySpace(facts);
		expect([...bySpace.keys()]).toEqual(["space-1", "space-2"]);
		expect(bySpace.get("space-1")?.map((f) => f.seq)).toEqual([1, 2]);
	});

	test("a run that finished or failed tells once per end; another end tells nobody", () => {
		const facts: NotifierFact[] = [
			{
				...base,
				seq: 7,
				changes: "summary",
				kind: "run-ended",
				status: "finished",
			},
			{
				...base,
				runId: "run-2",
				seq: 8,
				changes: "summary",
				kind: "run-ended",
				status: "failed",
			},
			{
				...base,
				runId: "run-3",
				seq: 9,
				changes: "summary",
				kind: "run-ended",
				status: "stopped",
			},
		];
		expect(
			endedRuns(facts).map(({ kind, runId }) => ({ kind, runId })),
		).toEqual([
			{ kind: "run-finished", runId: "run-1" },
			{ kind: "run-failed", runId: "run-2" },
		]);
		const [first, second] = endedRuns(facts);
		expect(first?.key).not.toBe(second?.key);
	});

	test("a run changed once, when its summary changed and no item told of it", () => {
		const facts: NotifierFact[] = [
			{ ...base, changes: "summary", kind: "step-ended", stepId: "a" },
			{ ...base, seq: 2, changes: "summary", kind: "other" },
			{ ...base, runId: "run-2", changes: "spend", kind: "other" },
			{
				...base,
				runId: "run-3",
				changes: "summary",
				kind: "gate-opened",
				stepId: "g",
			},
			{ ...base, runId: "run-4", changes: "summary", kind: "other" },
		];
		expect([...changedRuns(facts, new Set(["run-4"]))]).toEqual(["run-1"]);
	});
});
