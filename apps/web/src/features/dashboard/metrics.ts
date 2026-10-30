import type { ChartConfig } from "@nightshift/ui/components/chart";

import type { NightsRange } from "@/shared/api";
import { formatCost } from "@/shared/format";
import { formatNight, formatNightShort } from "./nights";

/**
 * The four numbers on top of a project's page, after Search Console: each
 * a tile you switch on to plot it, over the page's range, beside the same
 * nights just before.
 */

export type Metric = "runs" | "finished" | "spend" | "gates";

type Totals = NightsRange["totals"];

export const METRICS: {
	key: Metric;
	label: string;
	/** Its line on the chart. Its tile uses `--metric-<key>-tile`. */
	color: string;
	format: (value: number | null) => string;
	/** The value of a period or a night. Null when it has none. */
	of: (totals: Omit<Totals, "perNight">) => number | null;
}[] = [
	{
		key: "runs",
		label: "Runs",
		color: "var(--metric-runs)",
		format: (value) => String(value ?? 0),
		of: (totals) => totals.runs,
	},
	{
		key: "finished",
		label: "Finished",
		color: "var(--metric-finished)",
		format: (value) => (value === null ? "—" : `${value}%`),
		of: finishedShare,
	},
	{
		key: "spend",
		label: "Spend",
		color: "var(--metric-spend)",
		format: (value) => formatCost(value ?? 0),
		of: (totals) => totals.costUsd,
	},
	{
		key: "gates",
		label: "Gates asked",
		color: "var(--metric-gates)",
		format: (value) => String(value ?? 0),
		of: (totals) => totals.gates,
	},
];

/** Each metric, and the same metric over the nights before, dashed. */
export const METRICS_CHART = Object.fromEntries(
	METRICS.flatMap(({ key, label, color }) => [
		[key, { label, color }],
		[`before_${key}`, { label: `${label}, the nights before`, color }],
	]),
) satisfies ChartConfig;

/** Finished out of the runs that finished or failed, in whole percent. */
function finishedShare(totals: Omit<Totals, "perNight">): number | null {
	return totals.ended === 0
		? null
		: Math.round((totals.finished / totals.ended) * 100);
}

export type MetricValues = Record<Metric, number | null>;

/** One night of the chart: its value per metric, and the night as far back. */
export type MetricRow = {
	label: string;
	title: string;
} & MetricValues &
	Partial<Record<`before_${Metric}`, number | null>>;

function valuesOf(totals: Omit<Totals, "perNight">): MetricValues {
	return Object.fromEntries(
		METRICS.map((metric) => [metric.key, metric.of(totals)]),
	) as MetricValues;
}

/**
 * The metrics of a range: per night for the chart, in all, and before.
 * `compared` is false while the nights before had no runs at all, so there
 * is nothing to set them against yet.
 */
export function metricsOf(range: NightsRange): {
	rows: MetricRow[];
	values: MetricValues;
	before: MetricValues;
	compared: boolean;
} {
	const rows = range.totals.perNight.map((night, index): MetricRow => {
		const before = range.before.perNight[index];
		return {
			label: formatNightShort(night.night),
			title: formatNight(night.night),
			...valuesOf(night),
			...(before
				? Object.fromEntries(
						METRICS.map((metric) => [
							`before_${metric.key}`,
							metric.of(before),
						]),
					)
				: {}),
		};
	});
	return {
		rows,
		values: valuesOf(range.totals),
		before: valuesOf(range.before),
		compared: range.before.runs > 0,
	};
}

/**
 * How a number moved against the same nights just before: a sentence, and
 * a short form for a tight row. Undefined `before` means the nights before
 * had no runs at all.
 */
export function changeOf(
	metric: Metric,
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
