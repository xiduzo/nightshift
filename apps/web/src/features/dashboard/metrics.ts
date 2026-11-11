import {
	CONSOLE_METRICS,
	type ConsoleMetric,
	type ConsoleValues,
	consoleNumbers,
	consoleValues,
} from "@nightshift/client";
import type { ChartConfig } from "@nightshift/ui/components/chart";

import type { NightsRange } from "@/shared/api";
import { formatDayShort, formatDayTitle } from "./days";

/**
 * The four numbers on top of a project's page, after Search Console: each
 * a tile you switch on to plot it, over the page's range, beside the same
 * days just before. The numbers come from the client, the colours from
 * the theme.
 */

export type Metric = ConsoleMetric;

/** Each metric, with its line on the chart. Its tile uses `--metric-<key>-tile`. */
export const METRICS = CONSOLE_METRICS.map((metric) => ({
	...metric,
	color: `var(--metric-${metric.key})`,
}));

/** Each metric, and the same metric over the days before, dashed. */
export const METRICS_CHART = Object.fromEntries(
	METRICS.flatMap(({ key, label, color }) => [
		[key, { label, color }],
		[`before_${key}`, { label: `${label}, the days before`, color }],
	]),
) satisfies ChartConfig;

export type MetricValues = ConsoleValues;

/** One day of the chart: its value per metric, and the day as far back. */
export type MetricRow = {
	label: string;
	title: string;
	spendTokens?: number;
	before_spendTokens?: number;
} & MetricValues &
	Partial<Record<`before_${Metric}`, number | null>>;

/**
 * The metrics of a range: per day for the chart, in all, and before.
 * `compared` is false while the days before had no runs at all, so there
 * is nothing to set them against yet.
 */
export function metricsOf(range: NightsRange): {
	rows: MetricRow[];
	values: MetricValues;
	before: MetricValues;
	compared: boolean;
	spendTokens: number;
	spendTokensBefore: number;
} {
	const rows = range.totals.perNight.map((day, index): MetricRow => {
		const before = range.before.perNight[index];
		return {
			label: formatDayShort(day.night),
			title: formatDayTitle(day.night),
			...consoleValues(day),
			spendTokens: day.tokens,
			...(before
				? {
						...Object.fromEntries(
							METRICS.map((metric) => [
								`before_${metric.key}`,
								metric.of(before),
							]),
						),
						before_spendTokens: before.tokens,
					}
				: {}),
		};
	});
	return {
		rows,
		...consoleNumbers(range),
		spendTokens: range.totals.tokens,
		spendTokensBefore: range.before.tokens,
	};
}
