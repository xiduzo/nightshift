import { isPausedTonight } from "./tonight";
import type { ScheduleSummary } from "./types";
import { scheduleName } from "./words";

/** How far ahead "the next 24 hours" looks. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** One schedule, with the project it belongs to. */
export type PlannedSchedule = {
	projectId: string;
	projectName: string;
	schedule: ScheduleSummary;
};

/**
 * The schedules of a Space by when they start:
 *
 * - `soon`: the next start is in the next 24 hours, or the schedule is
 *   paused tonight. Soonest first, the paused ones last.
 * - `later`: the next start is after that. Soonest first.
 * - `idle`: no time to start: off, on a webhook, or no next start. By name.
 */
export type SchedulePlan = {
	soon: PlannedSchedule[];
	later: PlannedSchedule[];
	idle: PlannedSchedule[];
};

/** Whether the schedule starts on its own at a time: on, a cron line, a next start. */
export function startsOnTime(schedule: ScheduleSummary): boolean {
	return schedule.enabled && !schedule.webhook && schedule.nextAt !== null;
}

/** The schedules of `entries` by when they start, at `now`. */
export function schedulePlan(
	entries: readonly PlannedSchedule[],
	now: number,
): SchedulePlan {
	const plan: SchedulePlan = { soon: [], later: [], idle: [] };
	for (const entry of entries) {
		const { schedule } = entry;
		if (!startsOnTime(schedule)) plan.idle.push(entry);
		else if (
			isPausedTonight(schedule, now) ||
			(schedule.nextAt ?? 0) - now < DAY_MS
		) {
			plan.soon.push(entry);
		} else plan.later.push(entry);
	}
	const byNext = (a: PlannedSchedule, b: PlannedSchedule) =>
		(a.schedule.nextAt ?? 0) - (b.schedule.nextAt ?? 0);
	const paused = (entry: PlannedSchedule) =>
		isPausedTonight(entry.schedule, now) ? 1 : 0;
	plan.soon.sort((a, b) => paused(a) - paused(b) || byNext(a, b));
	plan.later.sort(byNext);
	plan.idle.sort((a, b) =>
		scheduleName(a.schedule).localeCompare(scheduleName(b.schedule)),
	);
	return plan;
}

/** The schedule that starts first and is not paused tonight, or null. */
export function nextPlanned(
	plan: SchedulePlan,
	now: number,
): PlannedSchedule | null {
	return (
		plan.soon.find((entry) => !isPausedTonight(entry.schedule, now)) ??
		plan.later[0] ??
		null
	);
}
