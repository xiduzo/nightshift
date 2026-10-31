import { finishedShare, formatCost } from "../runs";
import type { DashboardSummary, NightRange, NightsRange } from "./types";

/**
 * The four numbers of a project's Console, after Search Console: each over
 * a range of nights, beside the same nights just before. The desktop plots
 * them, the phone shows them as a glance.
 */

export type ConsoleMetric = "runs" | "finished" | "spend" | "gates";

type Totals = Omit<NightsRange["totals"], "perNight">;

export const CONSOLE_METRICS: readonly {
	key: ConsoleMetric;
	label: string;
	format: (value: number | null) => string;
	/** The value of a period or a night. Null when it has none. */
	of: (totals: Totals) => number | null;
}[] = [
	{
		key: "runs",
		label: "Runs",
		format: (value) => String(value ?? 0),
		of: (totals) => totals.runs,
	},
	{
		key: "finished",
		label: "Finished",
		format: (value) => (value === null ? "—" : `${value}%`),
		of: (totals) => finishedShare(totals.finished, totals.ended),
	},
	{
		key: "spend",
		label: "Spend",
		format: (value) => formatCost(value ?? 0),
		of: (totals) => totals.costUsd,
	},
	{
		key: "gates",
		label: "Gates asked",
		format: (value) => String(value ?? 0),
		of: (totals) => totals.gates,
	},
];

export type ConsoleValues = Record<ConsoleMetric, number | null>;

/** The value of each metric over a period or a night. */
export function consoleValues(totals: Totals): ConsoleValues {
	return Object.fromEntries(
		CONSOLE_METRICS.map((metric) => [metric.key, metric.of(totals)]),
	) as ConsoleValues;
}

/**
 * The numbers of a range, and of the nights just before. `compared` is
 * false while the nights before had no runs at all, so there is nothing to
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

/** The part of the dashboard's numbers a range picks. */
export function nightsOf(
	summary: DashboardSummary,
	range: NightRange,
): NightsRange {
	const found = summary.nights.find((nights) => nights.nights === range);
	if (!found) throw new Error(`The dashboard has no range of ${range} nights.`);
	return found;
}

/**
 * How a number moved against the same nights just before: a sentence, and
 * a short form for a tight row. Undefined `before` means the nights before
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
		return { trend: "flat", text: "No runs ended in these nights", short: "—" };
	}
	if (before === null) {
		return {
			trend: "flat",
			text: "No runs ended in the nights before",
			short: "—",
		};
	}
	if (before === 0 && value > 0) {
		return { trend: "up", text: "None in the nights before", short: "new" };
	}
	const delta = value - before;
	if (Math.abs(delta) < 0.005) {
		return { trend: "flat", text: "Same as the nights before", short: "same" };
	}
	const amount =
		metric === "spend" ? formatCost(Math.abs(delta)) : String(Math.abs(delta));
	const unit = metric === "finished" ? " points" : "";
	return {
		trend: delta > 0 ? "up" : "down",
		text: `${amount}${unit} ${delta > 0 ? "more" : "less"} than the nights before`,
		short: `${delta > 0 ? "+" : "−"}${amount}${metric === "finished" ? " pts" : ""}`,
	};
}
