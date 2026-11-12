import type { FlowReport, NightsRange } from "@/shared/api";
import { OVERVIEW_ROWS } from "./overview";

/** The rows of Home's Latest reports card, and how many flows it leaves out. */
export type LatestReports = {
	rows: FlowReport[];
	/** The flows with a report in the range. */
	count: number;
	hidden: number;
};

/**
 * What Home's Latest reports card shows over the page's range: one row per
 * flow, newest first, at most {@link OVERVIEW_ROWS}, and how many flows it
 * leaves out. Null when an older Host sends no reports: the card hides.
 */
export function latestReports(
	reports: NightsRange["reports"],
): LatestReports | null {
	if (!reports) return null;
	const rows = reports.rows.slice(0, OVERVIEW_ROWS);
	return {
		rows,
		count: reports.count,
		hidden: Math.max(0, reports.count - rows.length),
	};
}

/** The empty line of the card: what it holds, and how to start. */
export function noReportsText(days: number): string {
	return `No run wrote a report in the last ${days} days. Add one to an End node.`;
}
