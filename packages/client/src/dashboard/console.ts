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
export function neededShare(totals: {
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

/**
 * The numbers of a range, and of the days just before. `compared` is
 * false while the days before had no runs at all, so there is nothing to
 * set them against yet.
 */
export function consoleNumbers(range: NightsRange): {
	values: ConsoleValues;
	before: ConsoleValues;
	compared: boolean;
} {
	return {
		values: consoleValues(range.totals),
		before: consoleValues(range.before),
		compared: range.before.runs > 0,
	};
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

/**
 * How a number moved against the same days just before: a sentence, and
 * a short form for a tight row. Undefined `before` means the days before
 * had no runs at all.
 */
export function changeOf(
	metric: ConsoleMetric,
	value: number | null,
	before: number | null | undefined,
): { trend: "up" | "down" | "flat"; text: string; short: string } {
	if (before === undefined) {
		return { trend: "flat", text: "Nothing to compare with yet", short: "new" };
	}
	if (value === null) {
		return {
			trend: "flat",
			text:
				metric === "needed"
					? "Not known for these days"
					: "No runs ended in these days",
			short: "—",
		};
	}
	if (before === null) {
		return {
			trend: "flat",
			text:
				metric === "needed"
					? "Not known for the days before"
					: "No runs ended in the days before",
			short: "—",
		};
	}
	if (before === 0 && value > 0) {
		return { trend: "up", text: "None in the days before", short: "new" };
	}
	const delta = value - before;
	if (Math.abs(delta) < 0.005) {
		return { trend: "flat", text: "Same as the days before", short: "same" };
	}
	const amount =
		metric === "spend" ? formatCost(Math.abs(delta)) : String(Math.abs(delta));
	const share =
		CONSOLE_METRICS.find((each) => each.key === metric)?.share ?? false;
	return {
		trend: delta > 0 ? "up" : "down",
		text: `${amount}${share ? " points" : ""} ${delta > 0 ? "more" : "less"} than the days before`,
		short: `${delta > 0 ? "+" : "−"}${amount}${share ? " pts" : ""}`,
	};
}
