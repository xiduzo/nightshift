import { describe, expect, test } from "bun:test";
import {
	computerText,
	lastSyncText,
	scheduleText,
	sourceSummary,
	sourceTitle,
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

	test("a folder source names its computer, another one by its name", () => {
		const folder = { kit: "kit:knowledge/folder" as const, inputs: {} };
		const here = { name: "studio-a", here: true };
		const there = { name: "studio-b", here: false };
		expect(sourceTitle(folder, here)).toBe("Folder on this computer");
		expect(computerText(folder, here)).toBe("On studio-a");
		expect(sourceTitle(folder, there)).toBe("Folder on studio-b");
		expect(computerText(folder, there)).toBeNull();
		expect(sourceTitle(folder, null)).toBe("Folder on this computer");
		expect(computerText(folder, null)).toBeNull();
		const web = { kit: "kit:knowledge/web" as const, inputs: {} };
		expect(sourceTitle(web, null)).toBe("Web pages");
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
