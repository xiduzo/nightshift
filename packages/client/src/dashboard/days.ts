import type { DashboardSummary, NightRange, NightsRange } from "./types";

/** The part of the dashboard's numbers a range of days picks. */
export function daysOf(
	summary: DashboardSummary,
	range: NightRange,
): NightsRange {
	const found = summary.nights.find((days) => days.nights === range);
	if (!found) throw new Error(`The dashboard has no range of ${range} days.`);
	return found;
}
