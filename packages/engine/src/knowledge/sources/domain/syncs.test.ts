import { describe, expect, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import {
	OWNER_ONLY,
	savedSchedules,
	sourceActions,
	sourceNamed,
} from "./syncs";

/** The pure rules of the sources: the sentences a person reads, and what a role allows. */

describe("the sentences", () => {
	test("a schedule is this computer's owner's to change", () => {
		expect(OWNER_ONLY).toBe(
			"Only the owner of this computer can change its schedules. Save it without Keep it up to date, or ask the owner.",
		);
	});

	test("a flow that is no source", () => {
		expect(() => sourceNamed({ web: null }, "web")).toThrow(
			new Refusal(
				"not-found",
				"This project has no such source. It may have been removed.",
			),
		);
	});
});

describe("sourceActions", () => {
	const all = { save: true, remove: true, startRuns: true, schedules: true };
	test("a flow someone drew only syncs", () => {
		expect(sourceActions({ source: null, schedule: null }, all)).toEqual({
			sync: true,
			edit: false,
			remove: false,
			removeFiles: true,
		});
	});

	test("a source with a schedule is removed only by who may change schedules", () => {
		const sync = {
			source: { kit: "kit:knowledge/web" as const, inputs: {} },
			schedule: { cron: "0 3 * * *", enabled: true },
		};
		expect(sourceActions(sync, { ...all, schedules: false }).remove).toBe(
			false,
		);
		expect(sourceActions(sync, all).remove).toBe(true);
	});
});

describe("savedSchedules", () => {
	test("a project with no copy here has none, and another failure stays a failure", async () => {
		expect(
			await savedSchedules(async () => {
				throw new Refusal("not-found", "No copy.");
			}),
		).toEqual([]);
		const failure = new Error("disk");
		await expect(
			savedSchedules(async () => {
				throw failure;
			}),
		).rejects.toBe(failure);
	});
});
