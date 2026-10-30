import { describe, expect, test } from "bun:test";

import type { RunSummary } from "../runs";
import { scheduleLastRuns } from "./last-runs";

/** The fields a run needs here. The rest does not matter to the count. */
const run = (
	id: string,
	status: RunSummary["status"],
	trigger: RunSummary["trigger"],
): RunSummary => ({ id, status, trigger }) as RunSummary;

const night = (at: number) =>
	({ kind: "schedule", scheduleId: "night", at }) as const;

describe("scheduleLastRuns", () => {
	test("keeps the schedule's own runs, newest first, up to the count", () => {
		const runs = [
			run("a", "running", night(4)),
			run("b", "finished", { kind: "manual" }),
			run("c", "failed", night(3)),
			run("d", "finished", { kind: "webhook", scheduleId: "hook", at: 2 }),
			run("e", "finished", night(1)),
			run("f", "finished", night(0)),
		];
		const last = scheduleLastRuns(runs, "night", 3);
		expect(last.runs.map((r) => r.id)).toEqual(["a", "c", "e"]);
		// The running one has not ended: it does not count.
		expect(last).toMatchObject({ ended: 2, finished: 1 });
	});

	test("counts the runs a webhook started", () => {
		const runs = [
			run("a", "finished", { kind: "webhook", scheduleId: "hook", at: 1 }),
		];
		expect(scheduleLastRuns(runs, "hook", 10)).toMatchObject({
			ended: 1,
			finished: 1,
		});
	});

	test("a schedule that never started a run has none", () => {
		expect(scheduleLastRuns([], "night", 10)).toEqual({
			runs: [],
			ended: 0,
			finished: 0,
		});
	});
});
