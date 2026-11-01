import { Cron } from "croner";

import type { Instant } from "./clock";
import { asDate, instant } from "./clock";

function cronOf(cron: string, timeZone?: string): Cron {
	// No callback: croner computes times and never starts a timer.
	return new Cron(cron.trim(), {
		mode: "5-part",
		...(timeZone ? { timezone: timeZone } : {}),
	});
}

/**
 * The next `count` times of the cron line strictly after `after`, on the
 * clock of `timeZone` (default: this computer's). Empty when it does not parse.
 */
export function nextCronTimes(
	cron: string,
	after: Instant,
	count = 1,
	timeZone?: string,
): Instant[] {
	try {
		return cronOf(cron, timeZone)
			.nextRuns(count, asDate(after))
			.map((date) => instant(date));
	} catch {
		return [];
	}
}

/**
 * The latest time of the cron line at or before `at`, on the clock of
 * `timeZone` (default: this computer's). Null when there is none or it
 * does not parse.
 */
export function latestCronTime(
	cron: string,
	at: Instant,
	timeZone?: string,
): Instant | null {
	try {
		// Croner strips milliseconds and excludes the reference itself: one
		// second later makes `at` count when it is a time of the line.
		const [previous] = cronOf(cron, timeZone).previousRuns(
			1,
			asDate(at + 1000),
		);
		return previous && instant(previous) <= at ? instant(previous) : null;
	} catch {
		return null;
	}
}
