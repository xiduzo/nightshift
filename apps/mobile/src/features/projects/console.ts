import {
	CONSOLE_METRICS,
	changeOf,
	consoleNumbers,
	type DashboardSummary,
	type NightRange,
} from "@nightshift/client";

/**
 * The Console of a project, kept simple for the phone: the four numbers
 * of the desktop over the last nights, each with how it moved against the
 * nights just before. No chart.
 */

/** The nights the glance covers: last week. */
export const GLANCE_NIGHTS: NightRange = 7;

export type GlanceTile = {
	key: string;
	label: string;
	value: string;
	/** How it moved: "3 more than the nights before". Null with nothing to compare. */
	change: string | null;
};

export type ConsoleGlance = {
	/** "Compared with the 7 nights before", or why there is nothing to compare. */
	hint: string;
	tiles: GlanceTile[];
	/** No runs in these nights, nor in the nights before. */
	empty: boolean;
};

/** The glance of a project's numbers. Null when the Host does not count these nights. */
export function consoleGlance(
	summary: DashboardSummary,
	nights: NightRange = GLANCE_NIGHTS,
): ConsoleGlance | null {
	const range = summary.nights.find((found) => found.nights === nights);
	if (!range) return null;
	const { values, before, compared } = consoleNumbers(range);
	return {
		hint: compared
			? `Compared with the ${nights} nights before`
			: "Nothing to compare with yet",
		tiles: CONSOLE_METRICS.map((metric) => ({
			key: metric.key,
			label: metric.label,
			value: metric.format(values[metric.key]),
			change: compared
				? changeOf(metric.key, values[metric.key], before[metric.key]).text
				: null,
		})),
		empty: range.totals.runs === 0 && !compared,
	};
}
