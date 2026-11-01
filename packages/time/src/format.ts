/**
 * How a person reads an instant. The text on screen uses the viewer's
 * zone, through date-fns `intlFormat` (the viewer's locale). The hover
 * text is the same instant in UTC, so two computers agree.
 */

import { tz } from "@date-fns/tz";
import { format, intlFormat, intlFormatDistance } from "date-fns";
import { enGB } from "date-fns/locale/en-GB";

import {
	DAY_MS,
	HOUR_MS,
	type Instant,
	localZone,
	MINUTE_MS,
	wall,
} from "./clock";

function zoned(
	at: Instant,
	options: Intl.DateTimeFormatOptions,
	timeZone: string,
): string {
	return intlFormat(at, { ...options, timeZone });
}

/** "7:12 AM": the time of day on the viewer's clock. */
export function formatTime(
	at: Instant,
	timeZone: string = localZone(),
): string {
	return zoned(at, { timeStyle: "short" }, timeZone);
}

/** "Oct 31, 2026, 7:12 AM": the date and the time on the viewer's clock. */
export function formatDateTime(
	at: Instant,
	timeZone: string = localZone(),
): string {
	return zoned(at, { dateStyle: "medium", timeStyle: "short" }, timeZone);
}

/** "Sat, Oct 31, 07:12 AM": a moment in the next days, with its weekday. */
export function formatDayTime(
	at: Instant,
	timeZone: string = localZone(),
): string {
	return zoned(
		at,
		{
			weekday: "short",
			day: "numeric",
			month: "short",
			hour: "2-digit",
			minute: "2-digit",
		},
		timeZone,
	);
}

/** "31 Oct": the day and the month on the viewer's clock. */
export function formatDay(at: Instant, timeZone: string = localZone()): string {
	return zoned(at, { day: "numeric", month: "short" }, timeZone);
}

/** "Friday": the weekday on the viewer's clock. */
export function formatWeekday(
	at: Instant,
	timeZone: string = localZone(),
): string {
	return zoned(at, { weekday: "long" }, timeZone);
}

/** "Saturday, October 31": the day on the viewer's clock, with its weekday. */
export function formatLongDay(
	at: Instant,
	timeZone: string = localZone(),
): string {
	return zoned(
		at,
		{ weekday: "long", day: "numeric", month: "long" },
		timeZone,
	);
}

/**
 * "3 minutes ago", "yesterday", "just now". A minute or less is "just now".
 * Longer spans use the same units the screens already show.
 */
export function formatRelative(at: Instant, now: Instant): string {
	const abs = Math.abs(at - now);
	if (abs < MINUTE_MS) return "just now";
	const unit =
		abs >= 365 * DAY_MS
			? "year"
			: abs >= 30 * DAY_MS
				? "month"
				: abs >= DAY_MS
					? "day"
					: abs >= HOUR_MS
						? "hour"
						: "minute";
	return intlFormatDistance(at, now, { unit, locale: "en", numeric: "auto" });
}

/**
 * The standardized instant, the same on every computer: "1 Nov 2026, 18:31 UTC".
 */
export function formatUtc(at: Instant): string {
	const text = format(at, "d MMM yyyy, HH:mm", {
		in: tz("UTC"),
		locale: enGB,
	});
	return `${text} UTC`;
}

/**
 * "06:00" when `at` is within a day of `now`, else "Tue 28 Oct at 06:00".
 * English, in `timeZone`, so every computer writes the same words.
 */
export function formatClock(
	at: Instant,
	now: Instant,
	timeZone: string,
): string {
	const options = { in: tz(timeZone), locale: enGB };
	const time = format(at, "HH:mm", options);
	if (at - now < DAY_MS) return time;
	return `${format(at, "EEE d MMM", options)} at ${time}`;
}

/**
 * The hover for an instant. The UTC time, the wall time in `zone` when
 * that zone is not the viewer's, and the Device when a schedule names one.
 */
export function hoverTime(
	at: Instant,
	options?: { zone?: string; device?: string | null },
): string {
	const parts = [formatUtc(at)];
	const zoneName = options?.zone;
	if (zoneName && zoneName !== localZone()) {
		const shown = wall(at, zoneName);
		const time = `${String(shown.hour).padStart(2, "0")}:${String(shown.minute).padStart(2, "0")}`;
		parts.push(`${time} in ${zoneName}`);
	}
	const device = options?.device?.trim();
	if (device) parts.push(`Runs on ${device}`);
	return parts.join(". ");
}
