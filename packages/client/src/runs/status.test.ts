import { describe, expect, test } from "bun:test";

import { groupStatuses, hasEnded, runStatusLabel, statusOf } from "./status";
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
