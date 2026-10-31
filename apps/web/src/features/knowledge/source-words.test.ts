import { describe, expect, test } from "bun:test";
import {
	lastSyncText,
	scheduleText,
	sourceActions,
	sourceSummary,
} from "./source-words";

const ago = () => "2 hours ago";

describe("source words", () => {
	test("a source in one line: its first value and how many more", () => {
		expect(
			sourceSummary({
				kit: "kit:knowledge/web",
				inputs: { urls: "https://example.com\nhttps://example.org\n" },
			}),
		).toBe("https://example.com and 1 more");
		expect(
			sourceSummary({
				kit: "kit:knowledge/folder",
				inputs: { path: "~/notes" },
			}),
		).toBe("~/notes");
		expect(sourceSummary({ kit: "kit:knowledge/jira", inputs: {} })).toBe(
			"Jira",
		);
	});

	test("the last sync and the schedule", () => {
		expect(lastSyncText(null, ago)).toBe("Not synced yet");
		expect(lastSyncText({ status: "running", at: 1 }, ago)).toBe("Syncing now");
		expect(lastSyncText({ status: "finished", at: 1 }, ago)).toBe(
			"Synced 2 hours ago",
		);
		expect(lastSyncText({ status: "interrupted", at: 1 }, ago)).toBe(
			"Last sync failed 2 hours ago",
		);
		expect(scheduleText({ cron: "0 6 * * *", enabled: true })).toBe(
			"Syncs every day at 06:00",
		);
		expect(scheduleText({ cron: "0 6 * * *", enabled: false })).toBe(
			"Its schedule is paused",
		);
		expect(scheduleText(null)).toBeNull();
	});
});

describe("what you may do with a source", () => {
	const source = { kit: "kit:knowledge/web" as const, inputs: { urls: "x" } };
	const schedule = { cron: "0 6 * * *", enabled: true };
	const all = { save: true, remove: true, startRuns: true, schedules: true };
	const none = {
		save: false,
		remove: false,
		startRuns: false,
		schedules: false,
	};

	test("a viewer gets none of the actions", () => {
		expect(sourceActions({ source, schedule }, none)).toEqual({
			sync: false,
			edit: false,
			remove: false,
			removeFiles: false,
		});
	});

	test("a Member edits and syncs, and removes a source without a schedule", () => {
		const member = { ...all, schedules: false };
		expect(sourceActions({ source, schedule: null }, member)).toEqual({
			sync: true,
			edit: true,
			remove: true,
			removeFiles: true,
		});
		expect(sourceActions({ source, schedule }, member).remove).toBe(false);
		expect(sourceActions({ source, schedule }, all).remove).toBe(true);
	});

	test("a flow someone drew only syncs here", () => {
		expect(sourceActions({ source: null, schedule: null }, all)).toEqual({
			sync: true,
			edit: false,
			remove: false,
			removeFiles: true,
		});
	});
});
