import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import { asDate } from "@nightshift/time";
import type { RunStatus } from "../../../run-status";
import { isOpenStatus, type KnownRunReads, knownRun } from "./run-files";

function reads(
	status: RunStatus,
	options: { active?: boolean; unread?: boolean; error?: unknown } = {},
): KnownRunReads {
	return {
		async runRow() {
			if (options.error) throw options.error;
			return { projectId: "project-1", createdAt: asDate(5) };
		},
		async runState() {
			return { status, end: { at: 9 }, runFolder: true };
		},
		flowUnread: async () => options.unread ?? false,
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
			keeps: false,
			runFolder: true,
		});
	});

	test("a run at work here keeps its folder, whatever its status", async () => {
		expect(
			(await knownRun("run-1", reads("failed", { active: true })))?.keeps,
		).toBe(true);
	});

	test("a run cut short keeps its folder while its flow does not read; a run that ended does not", async () => {
		const keeps = async (status: RunStatus, unread: boolean) =>
			(await knownRun("run-1", reads(status, { unread })))?.keeps;
		expect(await keeps("interrupted", true)).toBe(true);
		expect(await keeps("interrupted", false)).toBe(false);
		for (const status of ["finished", "failed", "stopped"] as const) {
			expect(await keeps(status, true)).toBe(false);
		}
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
