/**
 * Instants and clocks. An instant is milliseconds since the Unix epoch,
 * UTC. Night Shift stores and passes that number.
 *
 * Calendar math goes through date-fns in an explicit IANA zone
 * (`in: tz(zone)`), so a Host and a Device agree, including across a
 * clock change. This package is the only place that calls date-fns,
 * `Date` or `Intl` for a clock. `scripts/check-time.ts` fails a call
 * anywhere else.
 */

import { TZDate, tz } from "@date-fns/tz";
import { UTCDate } from "@date-fns/utc";
import {
	addDays,
	addHours,
	type ContextOptions,
	getDate,
	getDay,
	getHours,
	getMinutes,
	getMonth,
	getYear,
	set,
	startOfDay,
	startOfHour,
} from "date-fns";

/** Milliseconds since 1970-01-01T00:00:00.000Z. The only instant Night Shift stores. */
export type Instant = number;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** The instant now, in UTC milliseconds. */
export function now(): Instant {
	return Date.now();
}

/**
 * A `Date` for a library that asks for one. The value is the same instant.
 * Callers do not read its calendar fields. They call `instant` to come back.
 */
export function asDate(at: Instant = now()): Date {
	return new UTCDate(at);
}

/** The instant a library's `Date` holds. */
export function instant(value: Date): Instant {
	return value.getTime();
}

/** UTC ISO-8601 with a `Z`, for storage, the wire, and `<time dateTime>`. */
export function iso(at: Instant): string {
	return new UTCDate(at).toISOString();
}

/**
 * Epoch ms of `text`, or `NaN` when it is not a time. The same reading as
 * `Date.parse`: a `Z` or an offset is that instant, and a time with no zone
 * is the clock of this machine. date-fns `parseISO` treats a date with no
 * zone as local, including a date-only day, so the wire keeps `Date.parse`.
 */
export function parseInstant(text: string): number {
	return Date.parse(text);
}

/**
 * The UTC instant for those fields. `month` is 0–11, the same count
 * `Date.UTC` uses. Tests move a `Date.UTC` call here without a shift.
 */
export function utc(
	year: number,
	month: number,
	day = 1,
	hour = 0,
	minute = 0,
	second = 0,
	millisecond = 0,
): Instant {
	return new UTCDate(
		year,
		month,
		day,
		hour,
		minute,
		second,
		millisecond,
	).getTime();
}

/** This machine's IANA time zone, or `UTC` when it has none. */
export function localZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
}

/** The date-fns context that calculates in `timeZone`. */
function zone(timeZone: string): ContextOptions<Date> {
	return { in: tz(timeZone) };
}

/** Whether `timeZone` is an IANA time zone this runtime knows. */
export function isTimeZone(timeZone: string): boolean {
	// An unknown name does not throw. The instant comes back as NaN.
	return (
		timeZone.length > 0 && !Number.isNaN(new TZDate(0, timeZone).getTime())
	);
}

export type Wall = {
	year: number;
	/** 1 to 12. */
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
	/** 0 is Sunday. */
	weekday: number;
};

/** What the clock on the wall shows in `timeZone` at `at`. */
export function wall(at: Instant, timeZone: string = localZone()): Wall {
	const inZone = zone(timeZone);
	return {
		year: getYear(at, inZone),
		month: getMonth(at, inZone) + 1,
		day: getDate(at, inZone),
		hour: getHours(at, inZone),
		minute: getMinutes(at, inZone),
		// date-fns getSeconds ignores the zone. TZDate reads it in the zone.
		second: new TZDate(at, timeZone).getSeconds(),
		weekday: getDay(at, inZone),
	};
}

export type WallTime = {
	year: number;
	/** 1 to 12. The day and the month may overflow. */
	month: number;
	day: number;
	hour?: number;
	minute?: number;
	second?: number;
	millisecond?: number;
};

/**
 * The instant the wall clock in `timeZone` shows that time. The day and
 * the month may overflow (day 0 is the last day of the month before).
 */
export function atWall(
	time: WallTime,
	timeZone: string = localZone(),
): Instant {
	return new TZDate(
		time.year,
		time.month - 1,
		time.day,
		time.hour ?? 0,
		time.minute ?? 0,
		time.second ?? 0,
		time.millisecond ?? 0,
		timeZone,
	).getTime();
}

/**
 * The instant a local `new Date(year, month, ...)` would be. `month` is
 * 0–11. `timeZone` defaults to this machine, so a test keeps its meaning.
 */
export function atLocal(
	year: number,
	month: number,
	day = 1,
	hour = 0,
	minute = 0,
	second = 0,
	millisecond = 0,
	timeZone: string = localZone(),
): Instant {
	return atWall(
		{
			year,
			month: month + 1,
			day,
			hour,
			minute,
			second,
			millisecond,
		},
		timeZone,
	);
}

/** The noon that starts the night `at` falls in, on the clock of `timeZone`. */
export function nightOf(at: Instant, timeZone: string): Instant {
	const inZone = zone(timeZone);
	const noon = set(
		startOfDay(at, inZone),
		{ hours: 12, minutes: 0, seconds: 0, milliseconds: 0 },
		inZone,
	);
	return (
		getHours(at, inZone) < 12 ? addDays(noon, -1, inZone) : noon
	).getTime();
}

/** The starts of the last `count` nights, oldest first, ending with tonight. */
export function lastNights(
	count: number,
	at: Instant,
	timeZone: string,
): Instant[] {
	const inZone = zone(timeZone);
	const tonight = nightOf(at, timeZone);
	return Array.from({ length: count }, (_, index) =>
		addDays(tonight, -(count - 1 - index), inZone).getTime(),
	);
}

/** The starts of the last `count` hours, oldest first, ending with this hour. */
export function lastHours(
	count: number,
	at: Instant,
	timeZone: string,
): Instant[] {
	const inZone = zone(timeZone);
	const thisHour = startOfHour(at, inZone);
	return Array.from({ length: count }, (_, index) =>
		addHours(thisHour, -(count - 1 - index), inZone).getTime(),
	);
}

/** Midnight that starts the calendar day of `at` in `timeZone`. */
export function dayStart(at: Instant, timeZone: string = localZone()): Instant {
	return startOfDay(at, zone(timeZone)).getTime();
}

/** Minutes since midnight of `at` in `timeZone`. */
export function minuteOfDay(at: Instant, timeZone: string): number {
	const inZone = zone(timeZone);
	return getHours(at, inZone) * 60 + getMinutes(at, inZone);
}

/** The hour of `at` in `timeZone`, 0–23. */
export function hourOf(at: Instant, timeZone: string = localZone()): number {
	return getHours(at, zone(timeZone));
}

/** The calendar day of `at` in `timeZone`, `YYYY-MM-DD`. */
export function dayKey(at: Instant, timeZone: string): string {
	const shown = wall(at, timeZone);
	const month = String(shown.month).padStart(2, "0");
	const day = String(shown.day).padStart(2, "0");
	return `${shown.year}-${month}-${day}`;
}
