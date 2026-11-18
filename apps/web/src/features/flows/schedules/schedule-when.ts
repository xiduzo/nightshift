import {
	cronToTimeAndDays,
	type Schedule,
	timeAndDaysToCron,
} from "@nightshift/flows";

/** How late a run may still start, in minutes. "" is the default, 15 minutes. */
export const LATE_CHOICES: readonly { minutes: string; label: string }[] = [
	{ minutes: "", label: "15 minutes" },
	{ minutes: "60", label: "1 hour" },
	{ minutes: "360", label: "6 hours" },
	{ minutes: "1440", label: "1 day" },
	{ minutes: "4320", label: "3 days" },
	{ minutes: "10080", label: "7 days" },
];

/** Monday first, the way a week reads. Day numbers as cron counts them: 0 is Sunday. */
export const WEEK = [
	{ day: 1, short: "Mon", long: "Monday" },
	{ day: 2, short: "Tue", long: "Tuesday" },
	{ day: 3, short: "Wed", long: "Wednesday" },
	{ day: 4, short: "Thu", long: "Thursday" },
	{ day: 5, short: "Fri", long: "Friday" },
	{ day: 6, short: "Sat", long: "Saturday" },
	{ day: 0, short: "Sun", long: "Sunday" },
];
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const DEFAULT_TIME = "22:00";
export const DEFAULT_STOP = "07:00";

export type When =
	| { mode: "simple"; time: string; days: number[] }
	| { mode: "cron"; cron: string };

export function initialWhen(schedule: Schedule | null): When {
	if (!schedule?.cron) {
		return { mode: "simple", time: DEFAULT_TIME, days: EVERY_DAY };
	}
	const simple = cronToTimeAndDays(schedule.cron);
	return simple
		? { mode: "simple", ...simple }
		: { mode: "cron", cron: schedule.cron };
}

export function cronOf(when: When): string | null {
	if (when.mode === "cron") return when.cron.trim() || null;
	return timeAndDaysToCron({ time: when.time, days: when.days });
}
