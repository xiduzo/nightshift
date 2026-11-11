import {
	CONSOLE_METRICS,
	type ConsoleMetric,
	consoleValues,
	type DashboardSummary,
	type NightRange,
	usageLabel,
} from "@nightshift/client";

/**
 * How a project did over the last days, kept simple for the phone: its
 * runs, the share that finished and what they cost. The desktop has the
 * chart and the comparison.
 */

/** The days the glance covers: last week, today included. */
export const GLANCE_DAYS: NightRange = 7;

/** The numbers the phone shows, in this order. */
const SHOWN: readonly ConsoleMetric[] = ["runs", "finished", "spend"];

export type DaysFact = { key: ConsoleMetric; label: string; value: string };

/** The facts of a project's last days. Null when the Host does not count these days. */
export function daysFacts(
	summary: DashboardSummary,
	days: NightRange = GLANCE_DAYS,
): DaysFact[] | null {
	const range = summary.nights.find((found) => found.nights === days);
	if (!range) return null;
	const values = consoleValues(range.totals);
	return CONSOLE_METRICS.filter((metric) => SHOWN.includes(metric.key)).map(
		(metric) => ({
			key: metric.key,
			label: metric.label,
			value:
				metric.key === "spend"
					? (usageLabel(
							range.totals.tokens,
							metric.format(values[metric.key]),
						) ?? metric.format(values[metric.key]))
					: metric.format(values[metric.key]),
		}),
	);
}
