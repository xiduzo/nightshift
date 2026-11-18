import { describe, expect, test } from "bun:test";
import { createScheduleHistories, scheduleKey } from "./schedule-history";

const P = "project-1";
const S = "nightly";

describe("the histories of the schedules", () => {
	test("know nothing of a schedule without a fact", () => {
		expect(createScheduleHistories().of(P, S)).toBeUndefined();
	});

	test("a fired fact is the last result, and its run is one the schedule started", () => {
		const book = createScheduleHistories();
		book.apply({
			kind: "fired",
			projectId: P,
			scheduleId: S,
			at: 100,
			runId: "run-1",
			error: null,
		});
		expect(book.of(P, S)).toEqual({
			lastAt: 100,
			last: { kind: "fired", at: 100, runId: "run-1" },
			runIds: ["run-1"],
		});
	});

	test("a start that failed reads as failed, with its words", () => {
		const book = createScheduleHistories();
		book.apply({
			kind: "fired",
			projectId: P,
			scheduleId: S,
			at: 100,
			runId: null,
			error: 'The flow "gone" does not exist.',
		});
		expect(book.of(P, S)).toEqual({
			lastAt: 100,
			last: {
				kind: "failed",
				at: 100,
				error: 'The flow "gone" does not exist.',
			},
			runIds: [],
		});

		book.apply({
			kind: "fired",
			projectId: P,
			scheduleId: S,
			at: 200,
			runId: null,
			error: null,
		});
		expect(book.of(P, S)?.last).toEqual({
			kind: "failed",
			at: 200,
			error: "The run did not start.",
		});
	});

	test("a skipped fact keeps its reason and the run that still ran", () => {
		const book = createScheduleHistories();
		book.apply({
			kind: "skipped",
			projectId: P,
			scheduleId: S,
			at: 100,
			reason: "An earlier run of this schedule is still waiting.",
			runId: "run-1",
		});
		expect(book.of(P, S)).toEqual({
			lastAt: 100,
			last: {
				kind: "skipped",
				at: 100,
				reason: "An earlier run of this schedule is still waiting.",
				runId: "run-1",
			},
			// It skipped for that run. It did not start it.
			runIds: [],
		});
	});

	test("the start of a run with the schedule as its trigger counts as fired", () => {
		const book = createScheduleHistories();
		book.apply({
			kind: "run-started",
			projectId: P,
			scheduleId: S,
			at: 100,
			runId: "cut-short",
		});
		expect(book.of(P, S)?.last).toEqual({
			kind: "fired",
			at: 100,
			runId: "cut-short",
		});
		// Its fired fact, read after it, adds no second run.
		book.apply({
			kind: "fired",
			projectId: P,
			scheduleId: S,
			at: 100,
			runId: "cut-short",
			error: null,
		});
		expect(book.of(P, S)?.runIds).toEqual(["cut-short"]);
	});

	test("an older fact does not replace a newer last result, and a fact of the same time does", () => {
		const book = createScheduleHistories();
		const fired = (at: number, runId: string) =>
			book.apply({
				kind: "fired",
				projectId: P,
				scheduleId: S,
				at,
				runId,
				error: null,
			});
		fired(200, "run-2");
		fired(100, "run-1");
		expect(book.of(P, S)).toEqual({
			lastAt: 200,
			last: { kind: "fired", at: 200, runId: "run-2" },
			runIds: ["run-2", "run-1"],
		});
		book.apply({
			kind: "skipped",
			projectId: P,
			scheduleId: S,
			at: 200,
			reason: "why",
			runId: null,
		});
		expect(book.of(P, S)?.last.kind).toBe("skipped");
	});

	test("a schedule id is its own in each project", () => {
		const book = createScheduleHistories();
		book.apply({
			kind: "fired",
			projectId: P,
			scheduleId: S,
			at: 100,
			runId: "run-1",
			error: null,
		});
		expect(book.of("project-2", S)).toBeUndefined();
		expect(scheduleKey(P, S)).not.toBe(scheduleKey("project-2", S));
	});
});
