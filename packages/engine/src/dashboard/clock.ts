/**
 * Nights and hours on the clock of the person who reads the dashboard.
 *
 * Nights, not days: runs start late and go past midnight, so a night runs
 * from noon to noon. A run at 23:00 and one at 01:00 belong to the same
 * night. Where noon falls depends on the person's time zone, so each
 * function takes one (an IANA name such as `Europe/Amsterdam`).
 */

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

const formats = new Map<string, Intl.DateTimeFormat>();

function formatOf(timeZone: string): Intl.DateTimeFormat {
	let format = formats.get(timeZone);
	if (!format) {
		format = new Intl.DateTimeFormat("en-US", {
			timeZone,
			hourCycle: "h23",
			year: "numeric",
			month: "numeric",
			day: "numeric",
			hour: "numeric",
			minute: "numeric",
			second: "numeric",
		});
		formats.set(timeZone, format);
	}
	return format;
}

/** Whether `timeZone` is a time zone this runtime knows. */
export function isTimeZone(timeZone: string): boolean {
	try {
		formatOf(timeZone);
		return true;
	} catch {
		return false;
	}
}

type WallClock = {
	year: number;
	/** 1 to 12. */
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
};

/** What the clock on the wall shows in `timeZone` at `epochMs`. */
function wallClock(epochMs: number, timeZone: string): WallClock {
	const parts: Record<string, number> = {};
	for (const part of formatOf(timeZone).formatToParts(epochMs)) {
		if (part.type !== "literal") parts[part.type] = Number(part.value);
	}
	return {
		year: parts.year ?? 1970,
		month: parts.month ?? 1,
		day: parts.day ?? 1,
		hour: parts.hour ?? 0,
		minute: parts.minute ?? 0,
		second: parts.second ?? 0,
	};
}

/** How far `timeZone` is ahead of UTC at `epochMs`. */
function offsetAt(epochMs: number, timeZone: string): number {
	const wall = wallClock(epochMs, timeZone);
	const asUtc = Date.UTC(
		wall.year,
		wall.month - 1,
		wall.day,
		wall.hour,
		wall.minute,
		wall.second,
	);
	return asUtc - (epochMs - (((epochMs % 1000) + 1000) % 1000));
}

/**
 * The moment the wall clock in `timeZone` shows `hour`:00 on that date. The
 * day may overflow (day 0 is the last day of the month before).
 */
function atWallClock(
	year: number,
	month: number,
	day: number,
	hour: number,
	timeZone: string,
): number {
	const guess = Date.UTC(year, month - 1, day, hour);
	const first = guess - offsetAt(guess, timeZone);
	const second = guess - offsetAt(first, timeZone);
	return second;
}

/** The noon that starts the night `epochMs` falls in. */
export function nightOf(epochMs: number, timeZone: string): number {
	const wall = wallClock(epochMs, timeZone);
	const day = wall.hour < 12 ? wall.day - 1 : wall.day;
	return atWallClock(wall.year, wall.month, day, 12, timeZone);
}

/** The starts of the last `count` nights, oldest first, ending with tonight. */
export function lastNights(
	count: number,
	now: number,
	timeZone: string,
): number[] {
	const tonight = wallClock(nightOf(now, timeZone), timeZone);
	return Array.from({ length: count }, (_, index) =>
		atWallClock(
			tonight.year,
			tonight.month,
			tonight.day - (count - 1 - index),
			12,
			timeZone,
		),
	);
}

/** The starts of the last `count` hours, oldest first, ending with this hour. */
export function lastHours(
	count: number,
	now: number,
	timeZone: string,
): number[] {
	const wall = wallClock(now, timeZone);
	const thisHour =
		now -
		(((now % 1000) + 1000) % 1000) -
		wall.minute * 60_000 -
		wall.second * 1000;
	return Array.from(
		{ length: count },
		(_, index) => thisHour - (count - 1 - index) * HOUR_MS,
	);
}
