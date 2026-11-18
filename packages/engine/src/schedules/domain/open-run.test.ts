import { describe, expect, test } from "bun:test";
import type { RunStatus } from "../../run-status";
import {
	OVERLAP_LOOKBACK,
	openRunOf,
	openRunRefusalWords,
	openRunSkipWords,
} from "./open-run";
import type { ScheduleHistory } from "./schedule-history";

/** A schedule that started these runs, oldest first. */
function started(...runIds: string[]): ScheduleHistory {
	const last = runIds.at(-1) ?? "none";
	return { lastAt: 100, last: { kind: "fired", at: 100, runId: last }, runIds };
}

/** The statuses by run id, and the runs that were asked for. */
function statuses(known: Record<string, RunStatus | null>) {
	const asked: string[] = [];
	return {
		asked,
		of: async (runId: string) => {
			asked.push(runId);
			return known[runId] ?? null;
		},
	};
}

describe("an earlier run of a schedule that is still open", () => {
	test("is one that is running, waiting or sleeping", async () => {
		for (const status of ["running", "waiting", "sleeping"] as const) {
			expect(
				await openRunOf(started("run-1"), statuses({ "run-1": status }).of),
			).toEqual({ runId: "run-1", status });
		}
	});

	test("is none when every run has ended or is gone", async () => {
		const { of } = statuses({
			"run-1": "finished",
			"run-2": "stopped",
			"run-3": "failed",
			"run-4": null,
		});
		expect(
			await openRunOf(started("run-1", "run-2", "run-3", "run-4"), of),
		).toBeNull();
		expect(await openRunOf(undefined, of)).toBeNull();
	});

	test("looks at the newest run first, and stops at the first open one", async () => {
		const { asked, of } = statuses({
			"run-1": "waiting",
			"run-2": "waiting",
			"run-3": "finished",
		});
		expect(await openRunOf(started("run-1", "run-2", "run-3"), of)).toEqual({
			runId: "run-2",
			status: "waiting",
		});
		expect(asked).toEqual(["run-3", "run-2"]);
	});

	test("looks at the last five runs only", async () => {
		const runIds = ["old", "a", "b", "c", "d", "e"];
		const { asked, of } = statuses({ old: "waiting" });
		expect(await openRunOf(started(...runIds), of)).toBeNull();
		expect(asked).toEqual(["e", "d", "c", "b", "a"]);
		expect(OVERLAP_LOOKBACK).toBe(5);
	});

	test("says why a cron time is skipped, and why Run now is refused", () => {
		const open = { runId: "run-1", status: "waiting" } as const;
		expect(openRunSkipWords(open)).toBe(
			"An earlier run of this schedule is still waiting.",
		);
		expect(openRunRefusalWords(open)).toBe(
			"An earlier run of this schedule is still waiting. Wait for it to end, or stop it.",
		);
	});
});
