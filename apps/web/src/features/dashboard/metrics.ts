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
	color: string;
	format: (value: number | null) => string;
	/** The value of a period or a night. Null when it has none. */
	of: (totals: Omit<Totals, "perNight">) => number | null;
}[] = [
	{
		key: "runs",
		label: "Runs",
		color: "var(--chart-2)",
		format: (value) => String(value ?? 0),
		of: (totals) => totals.runs,
	},
	{
		key: "finished",
		label: "Finished",
		color: "var(--status-finished)",
		format: (value) => (value === null ? "—" : `${value}%`),
		of: finishedShare,
	},
	{
		key: "spend",
		label: "Spend",
		color: "var(--status-sleeping)",
		format: (value) => formatCost(value ?? 0),
		of: (totals) => totals.costUsd,
	},
	{
		key: "gates",
		label: "Gates asked",
		color: "var(--status-waiting)",
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

/** The metrics of a range: per night for the chart, in all, and before. */
export function metricsOf(range: NightsRange): {
	rows: MetricRow[];
	values: MetricValues;
	before: MetricValues;
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
	};
}
