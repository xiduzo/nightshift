import { describe, expect, test } from "bun:test";

import {
	groupCounts,
	groupStatuses,
	hasEnded,
	runStatusLabel,
	statusOf,
} from "./status";
import type { RunStatus } from "./types";

const STATUSES: RunStatus[] = [
	"running",
	"waiting",
	"sleeping",
	"finished",
	"failed",
	"stopped",
	"interrupted",
];

describe("the group a run counts in", () => {
	test("one table for every list, chip and tile", () => {
		expect(
			Object.fromEntries(
				STATUSES.map((status) => [status, statusOf({ status }).group]),
			),
		).toEqual({
			running: "running",
			waiting: "needs-you",
			sleeping: "running",
			finished: "finished",
			failed: "failed",
			stopped: "stopped",
			interrupted: "stopped",
		});
	});

	test("Running now is running and asleep: a run at a Gate counts where you act", () => {
		expect(groupStatuses("running")).toEqual(["running", "sleeping"]);
		expect(groupStatuses("needs-you")).toEqual(["waiting"]);
	});

	test("Failed is failed only: an interrupted run stopped before its work was done", () => {
		expect(groupStatuses("failed")).toEqual(["failed"]);
		expect(groupStatuses("stopped")).toEqual(["stopped", "interrupted"]);
		expect(groupStatuses("failed", "stopped")).toEqual([
			"failed",
			"stopped",
			"interrupted",
		]);
	});

	test("counts per status add up per group, and every run counts once", () => {
		const counts = {
			running: 1,
			sleeping: 2,
			waiting: 3,
			finished: 4,
			failed: 5,
			stopped: 6,
			interrupted: 7,
		};
		expect(groupCounts(counts)).toEqual({
			running: 3,
			"needs-you": 3,
			failed: 5,
			stopped: 13,
			finished: 4,
		});
		const total = Object.values(groupCounts(counts)).reduce((a, b) => a + b);
		expect(total).toBe(28);
	});

	test("a count of something that is no status counts nowhere", () => {
		expect(groupCounts({ failed: 2, archived: 9 })).toMatchObject({
			failed: 2,
			stopped: 0,
		});
		expect(groupCounts({})).toEqual({
			running: 0,
			"needs-you": 0,
			failed: 0,
			stopped: 0,
			finished: 0,
		});
	});

	test("knows which statuses have ended", () => {
		expect(STATUSES.filter(hasEnded)).toEqual([
			"finished",
			"failed",
			"stopped",
			"interrupted",
		]);
	});
});

describe("a run's status as every screen shows it", () => {
	test("a run that had nothing to do reads so, and looks quiet", () => {
		expect(statusOf({ status: "finished", result: "nothing-to-do" })).toEqual({
			key: "nothing-to-do",
			word: "Nothing to do",
			group: "finished",
			ended: true,
		});
	});

	test("every other run reads its status", () => {
		expect(statusOf({ status: "finished", result: "done" })).toMatchObject({
			key: "finished",
			word: "Finished",
		});
		expect(statusOf({ status: "failed", result: "failed" })).toMatchObject({
			key: "failed",
			word: "Failed",
		});
		expect(statusOf({ status: "waiting" })).toEqual({
			key: "waiting",
			word: "Waiting for you",
			group: "needs-you",
			ended: false,
		});
		for (const status of STATUSES) {
			expect(statusOf({ status, result: null }).word).toBe(
				runStatusLabel(status),
			);
		}
	});
});
