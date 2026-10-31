import { describe, expect, test } from "bun:test";
import { ORPCError } from "@orpc/client";

import { nudgeProblem, scheduleNudges, withPause } from "./nudges";
import { nextPlanned, type PlannedSchedule, schedulePlan } from "./plan";
import type { ScheduleSummary } from "./types";
import { scheduleName, scheduleWhen } from "./words";

const HOUR = 60 * 60 * 1000;
const NOW = 1_000 * HOUR;

/** A cron schedule that is on. Its other fields do not matter here. */
const schedule = (
	id: string,
	fields: Partial<ScheduleSummary> = {},
): ScheduleSummary =>
	({
		id,
		flow: id,
		cron: "0 22 * * *",
		enabled: true,
		nextAt: NOW + HOUR,
		inputs: {},
		last: null,
		deliveries: [],
		issues: [],
		...fields,
	}) as ScheduleSummary;

const entry = (s: ScheduleSummary): PlannedSchedule => ({
	projectId: "p",
	projectName: "website",
	schedule: s,
});

const ids = (entries: PlannedSchedule[]) => entries.map((e) => e.schedule.id);

describe("schedulePlan", () => {
	test("the next 24 hours, soonest first, the paused ones last", () => {
		const plan = schedulePlan(
			[
				entry(schedule("late", { nextAt: NOW + 5 * HOUR })),
				entry(
					schedule("paused", {
						nextAt: NOW + 30 * HOUR,
						pausedUntil: NOW + 8 * HOUR,
					}),
				),
				entry(schedule("early", { nextAt: NOW + HOUR })),
			],
			NOW,
		);
		expect(ids(plan.soon)).toEqual(["early", "late", "paused"]);
		expect(plan.later).toEqual([]);
	});

	test("a start after 24 hours is later, and a pause that ended is no pause", () => {
		const plan = schedulePlan(
			[
				entry(schedule("weekly", { nextAt: NOW + 72 * HOUR })),
				entry(
					schedule("ended", {
						nextAt: NOW + 30 * HOUR,
						pausedUntil: NOW - HOUR,
					}),
				),
			],
			NOW,
		);
		expect(plan.soon).toEqual([]);
		expect(ids(plan.later)).toEqual(["ended", "weekly"]);
	});

	test("off, webhook and no-next schedules have no time, by name", () => {
		const plan = schedulePlan(
			[
				entry(schedule("zeta", { enabled: false })),
				entry(
					schedule("alpha", {
						cron: undefined,
						webhook: {} as ScheduleSummary["webhook"],
						nextAt: null,
					}),
				),
				entry(schedule("mid", { nextAt: null })),
			],
			NOW,
		);
		expect(ids(plan.idle)).toEqual(["alpha", "mid", "zeta"]);
		expect(plan.soon).toEqual([]);
	});

	test("the next one skips a schedule paused tonight", () => {
		const plan = schedulePlan(
			[
				entry(schedule("paused", { pausedUntil: NOW + 8 * HOUR })),
				entry(schedule("weekly", { nextAt: NOW + 72 * HOUR })),
			],
			NOW,
		);
		expect(nextPlanned(plan, NOW)?.schedule.id).toBe("weekly");
		expect(nextPlanned(schedulePlan([], NOW), NOW)).toBeNull();
	});
});

describe("scheduleNudges", () => {
	test("a schedule on a clock can pause tonight and run now", () => {
		expect(scheduleNudges(schedule("a"), NOW)).toEqual({
			pause: true,
			resume: false,
			runNow: true,
		});
	});

	test("a paused schedule can resume tonight", () => {
		const paused = schedule("a", { pausedUntil: NOW + HOUR });
		expect(scheduleNudges(paused, NOW)).toMatchObject({
			pause: false,
			resume: true,
		});
	});

	test("an off schedule cannot pause, a signal without a flow cannot run", () => {
		expect(scheduleNudges(schedule("a", { enabled: false }), NOW).pause).toBe(
			false,
		);
		expect(scheduleNudges(schedule("a", { flow: undefined }), NOW).runNow).toBe(
			false,
		);
	});
});

describe("nudgeProblem", () => {
	test("an older Host's plain 404 is an outdated Host", () => {
		const error = new ORPCError("NOT_FOUND", {
			status: 404,
			data: { status: 404, headers: {} },
		});
		expect(nudgeProblem(error)).toBe("host-outdated");
	});

	test("the Host's own refusals keep their meaning", () => {
		expect(
			nudgeProblem(
				new ORPCError("NOT_FOUND", {
					message: "This schedule does not exist.",
				}),
			),
		).toBe("gone");
		expect(nudgeProblem(new ORPCError("CONFLICT"))).toBe("busy");
		expect(nudgeProblem(new ORPCError("BAD_REQUEST"))).toBe("refused");
		expect(nudgeProblem(new ORPCError("FORBIDDEN"))).toBe("forbidden");
		expect(nudgeProblem(new Error("Network request failed"))).toBe("other");
	});
});

describe("withPause", () => {
	const list = {
		path: "schedules.json",
		issues: [],
		schedules: [schedule("a"), schedule("b", { pausedUntil: NOW + HOUR })],
	};

	test("a pause sets the end and the next start of that schedule only", () => {
		const next = withPause(list, "a", {
			pausedUntil: NOW + 8 * HOUR,
			nextAt: NOW + 25 * HOUR,
		});
		expect(next.schedules[0]).toMatchObject({
			pausedUntil: NOW + 8 * HOUR,
			nextAt: NOW + 25 * HOUR,
		});
		expect(next.schedules[1]).toBe(list.schedules[1]);
	});

	test("a resume takes the pause away", () => {
		const next = withPause(list, "b", {
			pausedUntil: null,
			nextAt: NOW + HOUR,
		});
		expect(next.schedules[1]).not.toHaveProperty("pausedUntil");
		expect(next.schedules[1]?.nextAt).toBe(NOW + HOUR);
	});
});

describe("schedule words", () => {
	test("the name is the flow, else the signal", () => {
		expect(scheduleName(schedule("a", { flow: "nightly" }))).toBe("nightly");
		expect(
			scheduleName(
				schedule("a", {
					flow: undefined,
					signal: { name: "deploy" } as ScheduleSummary["signal"],
				}),
			),
		).toBe("deploy");
	});

	test("when reads the cron line, or a webhook", () => {
		expect(scheduleWhen({ cron: "0 22 * * *" })).toMatch(/^[A-Z]/);
		expect(scheduleWhen({ webhook: {} as ScheduleSummary["webhook"] })).toBe(
			"When a webhook arrives",
		);
		expect(scheduleWhen({})).toBe("Never");
	});
});
