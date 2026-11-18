import { describe, expect, test } from "bun:test";
import type { Schedule } from "@nightshift/flows";
import { atLocal, utc } from "@nightshift/time/testing";
import type { ScheduleHistory } from "./schedule-history";
import {
	type CronSchedule,
	createScheduleWatch,
	cronScheduleOf,
	SCHEDULE_GRACE_MS,
} from "./schedule-watch";

/** Local time on the computer's clock, October 2026 (the 16th is a Friday). */
function at(day: number, hours: number, minutes = 0, seconds = 0): number {
	return atLocal(2026, 9, day, hours, minutes, seconds);
}

function nightly(extra: Partial<Schedule> = {}): CronSchedule {
	return {
		id: "nightly",
		flow: "night",
		inputs: {},
		cron: "0 22 * * *",
		enabled: true,
		...extra,
	} as CronSchedule;
}

/** A schedule that fired at `lastAt`. */
function firedAt(lastAt: number): ScheduleHistory {
	return {
		lastAt,
		last: { kind: "fired", at: lastAt, runId: "run-1" },
		runIds: ["run-1"],
	};
}

const P = "project-1";

describe("what a due cron time does", () => {
	test("starts at its time, and nothing is due before it", () => {
		const watch = createScheduleWatch(at(16, 21, 59));
		watch.watch(P, "nightly", at(16, 21, 59));
		expect(watch.decide(P, nightly(), at(16, 21, 59), undefined)).toEqual({
			kind: "none",
		});
		expect(watch.decide(P, nightly(), at(16, 22, 0, 20), undefined)).toEqual({
			kind: "start",
			due: at(16, 22),
		});
	});

	test("reads the cron line on the schedule's clock, not this computer's", () => {
		// 22:00 in Tokyo on the 16th is 13:00 UTC.
		const started = utc(2026, 9, 16, 12, 59);
		const watch = createScheduleWatch(started);
		watch.watch(P, "nightly", started);
		const tokyo = nightly({ timeZone: "Asia/Tokyo" });
		expect(
			watch.decide(P, tokyo, utc(2026, 9, 16, 13, 0, 20), undefined),
		).toEqual({ kind: "start", due: utc(2026, 9, 16, 13) });
	});

	test("a time the log has handled does nothing: it fires at most once", () => {
		const watch = createScheduleWatch(at(16, 22, 5));
		expect(
			watch.decide(P, nightly(), at(16, 22, 5), firedAt(at(16, 22))),
		).toEqual({ kind: "none" });
		// Run now at 22:03 counts for the 22:00 that came before it.
		expect(
			watch.decide(P, nightly(), at(16, 22, 5), firedAt(at(16, 22, 3))),
		).toEqual({ kind: "none" });
	});

	test("a time missed by less than the grace starts after a restart", () => {
		const watch = createScheduleWatch(at(16, 22, 14));
		watch.watch(P, "nightly", at(16, 22, 14));
		expect(watch.decide(P, nightly(), at(16, 22, 14), undefined)).toEqual({
			kind: "start",
			due: at(16, 22),
		});
		expect(SCHEDULE_GRACE_MS).toBe(15 * 60_000);
	});

	test("a time that fell while the daemon was down is missed past the grace, with the reason", () => {
		// Down all day. Back the next evening, 30 minutes after the time.
		const watch = createScheduleWatch(at(17, 22, 30));
		watch.watch(P, "nightly", at(17, 22, 30));
		expect(
			watch.decide(P, nightly(), at(17, 22, 30), firedAt(at(16, 22))),
		).toEqual({
			kind: "missed",
			due: at(17, 22),
			reason:
				"Missed by 30 min. Night Shift was off, or the computer was asleep. This schedule starts at most 15 min late.",
			missed: {
				projectId: P,
				scheduleId: "nightly",
				flow: "night",
				at: at(17, 22),
			},
		});
	});

	test("a time the watch saw come due but slept through is missed", () => {
		const watch = createScheduleWatch(at(16, 21, 59));
		watch.watch(P, "nightly", at(16, 21, 59));
		// The computer slept from 21:59 to 23:00.
		const decision = watch.decide(P, nightly(), at(16, 23), undefined);
		expect(decision).toMatchObject({
			kind: "missed",
			due: at(16, 22),
			reason: expect.stringContaining("Missed by 1 h."),
		});
	});

	test("a missed time names the schedule's clock when it has one", () => {
		const started = utc(2026, 9, 16, 12, 59);
		const watch = createScheduleWatch(started);
		watch.watch(P, "nightly", started);
		const decision = watch.decide(
			P,
			nightly({ timeZone: "Asia/Tokyo" }),
			utc(2026, 9, 16, 14),
			undefined,
		);
		expect(decision).toMatchObject({
			kind: "missed",
			missed: { timeZone: "Asia/Tokyo" },
		});
	});

	test("a schedule added after its time is not missed: the time is ignored", () => {
		const watch = createScheduleWatch(at(16, 23));
		watch.watch(P, "nightly", at(16, 23));
		expect(watch.decide(P, nightly(), at(16, 23), undefined)).toEqual({
			kind: "none",
		});
		// Its lateMinutes do not start a time from before it existed.
		expect(
			watch.decide(P, nightly({ lateMinutes: 1440 }), at(16, 23), undefined),
		).toEqual({ kind: "none" });
	});

	test("a missed time starts within the schedule's lateMinutes, and is missed past them", () => {
		// Off from 21:30 to 23:30, over 22:00, for a schedule that fired before.
		const watch = createScheduleWatch(at(17, 23, 30));
		watch.watch(P, "nightly", at(17, 23, 30));
		const history = firedAt(at(16, 22));
		expect(
			watch.decide(P, nightly({ lateMinutes: 1440 }), at(17, 23, 30), history),
		).toEqual({ kind: "start", due: at(17, 22) });
		expect(
			watch.decide(P, nightly({ lateMinutes: 60 }), at(17, 23, 30), history),
		).toMatchObject({
			kind: "missed",
			due: at(17, 22),
			reason:
				"Missed by 1 h 30 min. Night Shift was off, or the computer was asleep. This schedule starts at most 1 h late.",
		});
	});

	test("lateMinutes below the grace shorten it", () => {
		const watch = createScheduleWatch(at(16, 21, 59));
		watch.watch(P, "nightly", at(16, 21, 59));
		expect(
			watch.decide(P, nightly({ lateMinutes: 5 }), at(16, 22, 10), undefined),
		).toMatchObject({
			kind: "missed",
			reason: expect.stringContaining("starts at most 5 min late"),
		});
	});

	test("says how late in minutes, hours and days", () => {
		const reasonAfter = (late: number, schedule = nightly()) => {
			const watch = createScheduleWatch(at(16, 21, 59));
			watch.watch(P, "nightly", at(16, 21, 59));
			const decision = watch.decide(P, schedule, at(16, 22) + late, undefined);
			return decision.kind === "missed" ? decision.reason : decision.kind;
		};
		expect(reasonAfter(45 * 60_000)).toStartWith("Missed by 45 min.");
		expect(reasonAfter(125 * 60_000)).toStartWith("Missed by 2 h 5 min.");
		expect(reasonAfter(120 * 60_000)).toStartWith("Missed by 2 h.");
		// The 16th of each month: three days later it is still the latest time.
		const monthly = nightly({ cron: "0 22 16 * *", lateMinutes: 2880 });
		expect(reasonAfter(72 * 60 * 60_000, monthly)).toBe(
			"Missed by 3 days. Night Shift was off, or the computer was asleep. This schedule starts at most 2 days late.",
		);
	});

	test("a schedule paused tonight skips each time before the pause ends", () => {
		const watch = createScheduleWatch(at(16, 21, 59));
		watch.watch(P, "nightly", at(16, 21, 59));
		const paused = nightly({ pausedUntil: at(17, 6) });
		expect(watch.decide(P, paused, at(16, 22, 0, 20), undefined)).toEqual({
			kind: "paused",
			due: at(16, 22),
			reason: "You paused this schedule for tonight.",
		});
		// The next evening the pause has ended.
		expect(
			watch.decide(P, paused, at(17, 22, 0, 20), {
				lastAt: at(16, 22),
				last: {
					kind: "skipped",
					at: at(16, 22),
					reason: "You paused this schedule for tonight.",
					runId: null,
				},
				runIds: [],
			}),
		).toEqual({ kind: "start", due: at(17, 22) });
	});

	test("an hourly schedule paused tonight starts again at the time the pause ends", () => {
		const watch = createScheduleWatch(at(16, 23, 30));
		watch.watch(P, "nightly", at(16, 23, 30));
		const hourly = nightly({ cron: "0 * * * *", pausedUntil: at(17, 6) });
		expect(watch.decide(P, hourly, at(17, 5, 0, 20), undefined)).toMatchObject({
			kind: "paused",
			due: at(17, 5),
		});
		expect(watch.decide(P, hourly, at(17, 6, 0, 20), undefined)).toEqual({
			kind: "start",
			due: at(17, 6),
		});
	});

	test("a missed time counts as missed, not as paused", () => {
		const watch = createScheduleWatch(at(16, 21, 59));
		watch.watch(P, "nightly", at(16, 21, 59));
		expect(
			watch.decide(
				P,
				nightly({ pausedUntil: at(17, 6) }),
				at(16, 23),
				undefined,
			),
		).toMatchObject({ kind: "missed" });
	});
});

describe("the scheduler's switch", () => {
	test("switched on again, a time that came due while off neither starts nor counts as missed", () => {
		const watch = createScheduleWatch(at(16, 21, 59));
		watch.watch(P, "nightly", at(16, 21, 59));
		watch.switchedOff();
		// On again at 22:00:30, within the grace of 22:00.
		watch.switchedOn(at(16, 22, 0, 30));
		watch.watch(P, "nightly", at(16, 22, 0, 30));
		expect(watch.decide(P, nightly(), at(16, 22, 0, 30), undefined)).toEqual({
			kind: "none",
		});
		// And long after it: not missed either.
		expect(watch.decide(P, nightly(), at(16, 23), undefined)).toEqual({
			kind: "none",
		});
		// The next time starts as usual.
		expect(watch.decide(P, nightly(), at(17, 22, 0, 10), undefined)).toEqual({
			kind: "start",
			due: at(17, 22),
		});
	});

	test("switched on without having been off changes nothing", () => {
		const watch = createScheduleWatch(at(16, 21, 59));
		watch.watch(P, "nightly", at(16, 21, 59));
		watch.switchedOn(at(16, 22, 0, 20));
		expect(watch.decide(P, nightly(), at(16, 22, 0, 20), undefined)).toEqual({
			kind: "start",
			due: at(16, 22),
		});
	});

	test("off forgets what was watched: a time slept through after it is ignored", () => {
		const watch = createScheduleWatch(at(16, 21));
		watch.watch(P, "nightly", at(16, 21));
		watch.switchedOff();
		watch.switchedOn(at(16, 21, 30));
		// Seen again only at 23:00: the 22:00 came due before this look.
		watch.watch(P, "nightly", at(16, 23));
		expect(watch.decide(P, nightly(), at(16, 23), undefined)).toEqual({
			kind: "none",
		});
	});
});

describe("what is watched", () => {
	test("the first look counts, and a schedule that is forgotten is watched anew", () => {
		const watch = createScheduleWatch(at(16, 21));
		watch.watch(P, "nightly", at(16, 21));
		watch.watch(P, "nightly", at(16, 23));
		expect(watch.decide(P, nightly(), at(16, 23), undefined)).toMatchObject({
			kind: "missed",
		});

		watch.unwatch(P, "nightly");
		watch.watch(P, "nightly", at(16, 23));
		expect(watch.decide(P, nightly(), at(16, 23), undefined)).toEqual({
			kind: "none",
		});
	});

	test("a schedule of another project with the same id is its own", () => {
		const watch = createScheduleWatch(at(16, 21));
		watch.watch(P, "nightly", at(16, 21));
		watch.watch("project-2", "nightly", at(16, 23));
		expect(watch.decide("project-2", nightly(), at(16, 23), undefined)).toEqual(
			{ kind: "none" },
		);
	});
});

describe("the next start", () => {
	test("is the next cron time, or a due time that still starts", () => {
		const watch = createScheduleWatch(at(16, 21, 59));
		expect(watch.nextStart(P, nightly(), at(16, 21, 59), undefined)).toBe(
			at(16, 22),
		);
		// Due and within the grace: the next look starts it.
		expect(watch.nextStart(P, nightly(), at(16, 22, 1), undefined)).toBe(
			at(16, 22),
		);
		// Handled: the next evening.
		expect(
			watch.nextStart(P, nightly(), at(16, 22, 1), firedAt(at(16, 22))),
		).toBe(at(17, 22));
		// Too late to start, and not watched: the next evening.
		expect(watch.nextStart(P, nightly(), at(16, 23), undefined)).toBe(
			at(17, 22),
		);
	});

	test("paused tonight, it is the first cron time at or after the pause ends", () => {
		const watch = createScheduleWatch(at(16, 12));
		expect(
			watch.nextStart(
				P,
				nightly({ pausedUntil: at(17, 6) }),
				at(16, 12),
				undefined,
			),
		).toBe(at(17, 22));
		expect(
			watch.nextStart(
				P,
				nightly({ cron: "0 * * * *", pausedUntil: at(17, 6) }),
				at(16, 23, 30),
				undefined,
			),
		).toBe(at(17, 6));
		// A pause that has ended means nothing.
		expect(
			watch.nextStart(
				P,
				nightly({ pausedUntil: at(17, 6) }),
				at(17, 9),
				undefined,
			),
		).toBe(at(17, 22));
	});

	test("is null for a schedule that is off, has no cron line or starts on a webhook", () => {
		const watch = createScheduleWatch(at(16, 12));
		const next = (schedule: Schedule) =>
			watch.nextStart(P, schedule, at(16, 12), undefined);
		expect(next(nightly({ enabled: false }))).toBeNull();
		expect(next({ id: "hook", inputs: {}, enabled: true })).toBeNull();
		expect(
			next(
				nightly({
					// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
					webhook: { secret: "${HOOK_SECRET}" },
				}),
			),
		).toBeNull();
	});
});

describe("a schedule the cron line starts", () => {
	test("has a cron line and a flow, is on, and has no webhook", () => {
		expect(cronScheduleOf(nightly())).toEqual(nightly());
		expect(cronScheduleOf(nightly({ enabled: false }))).toBeNull();
		expect(cronScheduleOf({ id: "a", inputs: {}, enabled: true })).toBeNull();
		expect(
			cronScheduleOf({
				id: "a",
				inputs: {},
				enabled: true,
				cron: "0 22 * * *",
			}),
		).toBeNull();
		expect(
			cronScheduleOf(
				nightly({
					// biome-ignore lint/suspicious/noTemplateCurlyInString: a secret reference, as a person writes it.
					webhook: { secret: "${HOOK_SECRET}" },
				}),
			),
		).toBeNull();
	});
});
