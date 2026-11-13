/**
 * Days and hours on the clock of the person who reads the dashboard. A
 * day runs from midnight to midnight there. The math is `@nightshift/time`
 * (date-fns, in that person's time zone).
 */

export {
	DAY_MS,
	dayStart,
	HOUR_MS,
	isTimeZone,
	lastDays,
	lastHours,
	wall,
} from "@nightshift/time";
