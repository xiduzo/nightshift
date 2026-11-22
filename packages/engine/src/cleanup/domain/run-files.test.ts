import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { asDate } from "@nightshift/time";
import type { RunStatus } from "../../run-status";
import { isOpenStatus, type KnownRunReads, knownRun } from "./run-files";

function reads(
	status: RunStatus,
	options: { active?: boolean; error?: unknown } = {},
): KnownRunReads {
	return {
		async runRow() {
			if (options.error) throw options.error;
			return { projectId: "project-1", createdAt: asDate(5) };
		},
		async runState() {
			return { status, end: { at: 9 }, runFolder: true };
		},
		isActive: () => options.active ?? false,
	};
}

describe("knownRun", () => {
	test("reads the run's row and state", async () => {
		expect(await knownRun("run-1", reads("finished"))).toEqual({
			id: "run-1",
			projectId: "project-1",
			createdAt: 5,
			endedAt: 9,
			open: false,
			runFolder: true,
		});
	});

	test("a run at work here is open, whatever its status", async () => {
		expect(
			(await knownRun("run-1", reads("failed", { active: true })))?.open,
		).toBe(true);
	});

	test("a run this computer does not know is null; another error goes on", async () => {
		const missing = new Refusal(
			"not-found",
			"Night Shift cannot find this run.",
		);
		expect(
			await knownRun("run-1", reads("failed", { error: missing })),
		).toBeNull();
		await expect(
			knownRun("run-1", reads("failed", { error: new Error("disk") })),
		).rejects.toThrow("disk");
	});
});

test("isOpenStatus: a run at work, at a Gate or asleep is open; an ended one is not", () => {
	const statuses: RunStatus[] = [
		"running",
		"waiting",
		"sleeping",
		"finished",
		"failed",
	];
	expect(statuses.filter(isOpenStatus)).toEqual([
		"running",
		"waiting",
		"sleeping",
	]);
});
