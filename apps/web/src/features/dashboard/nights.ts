/**
 * Nights, not days: runs start late and go past midnight, so a night runs
 * from noon to noon. Night Shift counts per night on your clock
 * (`dashboard.summary`). These name a night by the noon it starts.
 */

import { formatDay, formatWeekdayDate } from "@nightshift/client";

/** "Wed 15 Oct": the evening a night starts. */
export function formatNight(nightStart: number): string {
	return formatWeekdayDate(nightStart);
}

/** "15 Oct": short, for a chart axis. */
export function formatNightShort(nightStart: number): string {
	return formatDay(nightStart);
}

/** The rows of a chart per night: a label and a title per night, and its counts. */
export function nightChartRows(
	perNight: readonly { night: number; counts: Record<string, number> }[],
): Record<string, number | string>[] {
	return perNight.map(({ night, counts }) => ({
		...counts,
		night,
		label: formatNightShort(night),
		title: formatNight(night),
	}));
}
