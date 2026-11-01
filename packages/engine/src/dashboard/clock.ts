/**
 * Nights and hours on the clock of the person who reads the dashboard.
 * The math is `@nightshift/time` (date-fns, in that person's time zone).
 */

export {
	DAY_MS,
	HOUR_MS,
	isTimeZone,
	lastHours,
	lastNights,
	nightOf,
} from "@nightshift/time";
