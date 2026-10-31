import { describe, expect, test } from "bun:test";
import { type ScheduleSummary, schedulePlan } from "@nightshift/client";

import { formatTime } from "@/shared/format";
import {
	lastLook,
	nextStartLine,
	nextText,
	planSummary,
	problemCopy,
	shownPaused,
	whenLine,
} from "./schedule-words";

const HOUR = 60 * 60 * 1000;
// Noon on a weekday, on this clock: the next hours stay on the same day.
const NOW = new Date(2026, 9, 28, 12, 0).getTime();

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

const plan = (...schedules: ScheduleSummary[]) =>
	schedulePlan(
		schedules.map((s) => ({ projectId: "p", projectName: "web", schedule: s })),
		NOW,
	);

describe("nextText", () => {
	test("a start says its day and time", () => {
		const at = NOW + 10 * HOUR;
		expect(nextText(schedule("a", { nextAt: at }), NOW)).toBe(
			`Today ${formatTime(at)}`,
		);
		expect(nextText(schedule("a", { nextAt: at + 24 * HOUR }), NOW)).toBe(
			`Tomorrow ${formatTime(at)}`,
		);
	});

	test("a schedule without a time says why", () => {
		expect(nextText(schedule("a", { enabled: false }), NOW)).toBe("Off");
		expect(
			nextText(
				schedule("a", { webhook: {} as ScheduleSummary["webhook"] }),
				NOW,
			),
		).toBe("On a webhook");
		expect(nextText(schedule("a", { nextAt: null }), NOW)).toBe(
			"No next start",
		);
	});
});

test("the stop time follows when it starts", () => {
	expect(whenLine(schedule("a", { stopAt: "06:00" }))).toMatch(
		/, stops 06:00$/,
	);
});

describe("lastLook", () => {
	test("the status of the run it started, or what kept it from one", () => {
		expect(
			lastLook({ kind: "fired", at: NOW, runId: "r", runStatus: "finished" })
				?.label,
		).toBe("Finished");
		expect(lastLook({ kind: "failed", at: NOW, error: "No flow" })?.label).toBe(
			"Did not start",
		);
		expect(
			lastLook({ kind: "skipped", at: NOW, reason: "Paused", runId: null })
				?.label,
		).toBe("Skipped");
		expect(lastLook(null)).toBeNull();
	});
});

test("a pause or resume on its way wins over the list", () => {
	const paused = schedule("a", { pausedUntil: NOW + HOUR });
	expect(shownPaused(paused, NOW, undefined)).toBe(true);
	expect(shownPaused(paused, NOW, "resume")).toBe(false);
	expect(shownPaused(schedule("a"), NOW, "pause")).toBe(true);
});

describe("planSummary and nextStartLine", () => {
	test("counts the starts of the next 24 hours and the pauses", () => {
		const both = plan(
			schedule("a"),
			schedule("b"),
			schedule("c", { pausedUntil: NOW + 18 * HOUR }),
		);
		expect(planSummary(both, NOW)).toBe(
			"2 start in the next 24 hours · 1 paused tonight",
		);
		expect(planSummary(plan(schedule("a")), NOW)).toBe(
			"1 starts in the next 24 hours",
		);
		expect(planSummary(plan(), NOW)).toBe(
			"Nothing starts in the next 24 hours",
		);
	});

	test("the next start skips a paused schedule", () => {
		const at = NOW + 11 * HOUR;
		expect(
			nextStartLine(
				plan(
					schedule("paused", { pausedUntil: NOW + 18 * HOUR }),
					schedule("nightly", { nextAt: at }),
				),
				NOW,
			),
		).toBe(`nightly, today ${formatTime(at)}`);
		expect(nextStartLine(plan(), NOW)).toBeNull();
	});
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
