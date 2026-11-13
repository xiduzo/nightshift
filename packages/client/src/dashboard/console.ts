import { finishedShare, formatCost } from "../runs";
import type { DashboardSummary, NightRange, NightsRange } from "./types";

/**
 * The four numbers of a project's Console, after Search Console: each over
 * a range of days, beside the same days just before. The desktop plots
 * them, the phone shows them as a glance.
 */

export type ConsoleMetric = "runs" | "finished" | "spend" | "needed";

type Totals = Omit<NightsRange["totals"], "perNight">;

/**
 * The share of runs started that needed you, in whole percent: a person
 * answered a Gate or an Ask, resumed, stopped, or took one over. Null
 * without runs, and from an older Host that does not count it.
 */
function neededShare(totals: {
	runs: number;
	neededYou?: number;
}): number | null {
	if (totals.neededYou === undefined || totals.runs === 0) return null;
	return Math.round((totals.neededYou / totals.runs) * 100);
}

export const CONSOLE_METRICS: readonly {
	key: ConsoleMetric;
	label: string;
	format: (value: number | null) => string;
	/** The value of a period or a day. Null when it has none. */
	of: (totals: Totals) => number | null;
	/** A percent from 0 to 100: its change is in points. */
	share: boolean;
}[] = [
	{
		key: "runs",
		label: "Runs",
		format: (value) => String(value ?? 0),
		of: (totals) => totals.runs,
		share: false,
	},
	{
		key: "finished",
		label: "Finished",
		format: (value) => (value === null ? "—" : `${value}%`),
		of: (totals) => finishedShare(totals.finished, totals.ended),
		share: true,
	},
	{
		key: "spend",
		label: "Spend",
		format: (value) => formatCost(value ?? 0),
		of: (totals) => totals.costUsd,
		share: false,
	},
	{
		key: "needed",
		label: "Needed you",
		format: (value) => (value === null ? "—" : `${value}%`),
		of: neededShare,
		share: true,
	},
];

export type ConsoleValues = Record<ConsoleMetric, number | null>;

/** The value of each metric over a period or a day. */
export function consoleValues(totals: Totals): ConsoleValues {
	return Object.fromEntries(
		CONSOLE_METRICS.map((metric) => [metric.key, metric.of(totals)]),
	) as ConsoleValues;
}

/** The part of the dashboard's numbers a range of days picks. */
export function daysOf(
	summary: DashboardSummary,
	range: NightRange,
): NightsRange {
	const found = summary.nights.find((days) => days.nights === range);
	if (!found) throw new Error(`The dashboard has no range of ${range} days.`);
	return found;
}
