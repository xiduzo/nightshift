import { describe, expect, test } from "bun:test";
import { lastSyncText, scheduleText, sourceSummary } from "./source-words";

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
