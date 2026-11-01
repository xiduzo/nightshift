import { describe, expect, test } from "bun:test";
import type { ScheduleSummary } from "@nightshift/client";
import { atLocal } from "@nightshift/client/testing";
import { problemCopy, shownPaused } from "./schedule-words";

const HOUR = 60 * 60 * 1000;
// Noon on a weekday, on this clock: the next hours stay on the same day.
const NOW = atLocal(2026, 9, 28, 12, 0);

const schedule = (
	id: string,
	fields: Partial<ScheduleSummary> = {},
): ScheduleSummary =>
	({
		id,
		flow: id,
		cron: "0 22 * * *",
		enabled: true,
		nextAt: NOW + 10 * HOUR,
		inputs: {},
		last: null,
		deliveries: [],
		issues: [],
		...fields,
	}) as ScheduleSummary;

test("a pause or resume on its way wins over the list", () => {
	const paused = schedule("a", { pausedUntil: NOW + HOUR });
	expect(shownPaused(paused, NOW, undefined)).toBe(true);
	expect(shownPaused(paused, NOW, "resume")).toBe(false);
	expect(shownPaused(schedule("a"), NOW, "pause")).toBe(true);
});

describe("problemCopy", () => {
	test("an older Host gets its own words, not the Host's", () => {
		const copy = problemCopy("pause", "host-outdated", "Not Found");
		expect(copy.title).toBe("Your Host cannot do this yet");
		expect(copy.message).not.toContain("Not Found");
	});

	test("the Host's reason stays, with the nudge as the title", () => {
		const reason = "An earlier run of this schedule is still running.";
		expect(problemCopy("runNow", "busy", reason)).toMatchObject({
			title: "The run did not start",
			message: reason,
		});
		expect(problemCopy("pause", "refused", "This schedule is off.")).toEqual({
			title: "Pause tonight did not work",
			message: "This schedule is off.",
		});
	});
});
