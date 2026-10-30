import type { DashboardSummary, NightRange, NightsRange } from "@/shared/api";

/** The part of the dashboard's numbers a range toggle picks. */

export function nightsOf(
	summary: DashboardSummary,
	range: NightRange,
): NightsRange {
	const found = summary.nights.find((nights) => nights.nights === range);
	if (!found) throw new Error(`The dashboard has no range of ${range} nights.`);
	return found;
}
