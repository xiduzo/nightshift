import { type DashboardSummary, markdownPreview } from "@nightshift/client";

/** The newest report of one flow in a range of days. */
export type WatchReport = NonNullable<
	DashboardSummary["nights"][number]["reports"]
>["rows"][number];

/** The days Watch looks back for reports, today included. */
const REPORT_DAYS = 7;

/** How many reports Watch shows. */
const REPORTS_SHOWN = 3;

/**
 * The reports of the last 7 days: the newest of each flow, the newest
 * first, at most three. Empty when no run wrote one, and when an older
 * Host sends no reports.
 */
export function latestReports(summary: DashboardSummary): WatchReport[] {
	const range = summary.nights.find((days) => days.nights === REPORT_DAYS);
	return range?.reports?.rows.slice(0, REPORTS_SHOWN) ?? [];
}

/**
 * The first line of a report as plain text, for a row: "Three new
 * papers on sleep". Empty when the report has no words.
 */
export function reportLine(excerpt: string): string {
	return (
		markdownPreview(excerpt, excerpt.length)
			.split("\n")
			.find((line) => line.trim() !== "") ?? ""
	);
}
