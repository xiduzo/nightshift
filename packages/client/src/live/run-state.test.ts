import { describe, expect, test } from "bun:test";

import type { RunStatus, StepSummary, TranscriptEntry } from "../runs";
import type { RunStreamBatch } from "./run-buffer";
import { applyRunBatch, type EntryFold, emptyLiveRun } from "./run-state";

const entry = (seq: number) => ({ seq, stepId: "build" }) as TranscriptEntry;
const step = (id: string, status = "running") =>
	({ id, status }) as unknown as StepSummary;

/** Keeps the seqs, in order. */
const seqs: EntryFold<number[]> = {
	empty: () => [],
	add: (kept, entries) => [...kept, ...entries.map((one) => one.seq)],
};

const batch = (part: Partial<RunStreamBatch>): RunStreamBatch => ({
	entries: [],
	steps: [],
	status: null,
	lastSeq: null,
	...part,
});

describe("what a screen keeps of a run's stream", () => {
	test("a step replaces the step of its id, a status the status, entries go to the screen's fold", () => {
		let state = emptyLiveRun(seqs);
		state = applyRunBatch(
			state,
			batch({
				entries: [entry(1), entry(2)],
				steps: [step("build"), step("test")],
				status: "running" as RunStatus,
			}),
			seqs,
		);
		state = applyRunBatch(
			state,
			batch({ entries: [entry(3)], steps: [step("build", "finished")] }),
			seqs,
		);
		expect([...state.steps.values()]).toEqual([
			step("build", "finished"),
			step("test"),
		]);
		expect(state.status).toBe("running" as RunStatus);
		expect(state.entries).toEqual([1, 2, 3]);
	});

	test("a part with nothing new stays the same object, so the screen does not render it again", () => {
		const before = applyRunBatch(
			emptyLiveRun(seqs),
			batch({ entries: [entry(1)], steps: [step("build")] }),
			seqs,
		);
		const after = applyRunBatch(
			before,
			batch({ status: "finished" as RunStatus }),
			seqs,
		);
		expect(after.steps).toBe(before.steps);
		expect(after.entries).toBe(before.entries);
		expect(after.status).toBe("finished" as RunStatus);
	});
});
