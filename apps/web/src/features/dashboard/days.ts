/**
 * Days on your clock, from midnight to midnight: Night Shift counts per
 * day (`dashboard.summary`). The reply names each day by its start, in
 * the key `night`.
 */

import { formatDay, formatWeekdayDate } from "@nightshift/client";

/** "Wed 15 Oct": a day, for a tooltip. */
export function formatDayTitle(dayStart: number): string {
	return formatWeekdayDate(dayStart);
}

/** "15 Oct": short, for a chart axis. */
export function formatDayShort(dayStart: number): string {
	return formatDay(dayStart);
}

/** The rows of a chart per day: a label and a title per day, and its counts. */
export function dayChartRows(
	perDay: readonly { night: number; counts: Record<string, number> }[],
): Record<string, number | string>[] {
	return perDay.map(({ night: day, counts }) => ({
		...counts,
		day,
		label: formatDayShort(day),
		title: formatDayTitle(day),
	}));
}
