import type { Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

/** The schedules of a project as a person saves them and names one of them. */

/**
 * Each schedule that starts at a time (`cron`) or stops at one (`stopAt`)
 * and has no time zone, on the clock of `timeZone`. One on another clock
 * keeps it.
 */
export function withTimeZone(
	schedules: readonly Schedule[],
	timeZone: string,
): Schedule[] {
	return schedules.map((schedule) =>
		schedule.timeZone === undefined &&
		(schedule.cron !== undefined || schedule.stopAt !== undefined)
			? { ...schedule, timeZone }
			: schedule,
	);
}

export const SCHEDULE_NOT_FOUND =
	"This schedule does not exist. Someone may have removed it.";

/**
 * The schedule of `scheduleId` among the project's schedules. A duplicate
 * id is an issue in the UI: the first one counts. Refuses (`not-found`)
 * an id that no schedule has.
 */
export function scheduleOf(
	schedules: readonly Schedule[],
	scheduleId: string,
): Schedule {
	const schedule = schedules.find((one) => one.id === scheduleId);
	if (!schedule) throw new Refusal("not-found", SCHEDULE_NOT_FOUND);
	return schedule;
}

/** The schedules with `changed` in the place of the one that has its id. */
export function withSchedule(
	schedules: readonly Schedule[],
	changed: Schedule,
): Schedule[] {
	return schedules.map((one) => (one.id === changed.id ? changed : one));
}
