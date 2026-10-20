import type { ChartConfig } from "@nightshift/ui/components/chart";

import type { Project, RunSummary } from "@/shared/api";
import { formatNight, formatNightShort, lastNights, nightOf } from "./nights";

/** Groups beyond this many fold into "Other". The theme has five chart colors. */
const MAX_GROUPS = 4;

/**
 * What spend is split by: the flow within one project, the project over all
 * of them.
 */
export function spendGroupOf(
	project: Project | undefined,
	projects: Project[] | undefined,
) {
	return (run: RunSummary) =>
		project
			? (run.flowName ?? "Quick runs")
			: (projects?.find((p) => p.id === run.projectId)?.name ?? "Removed");
}

export type SpendGroup = {
	/** A CSS-safe key for the chart (`--color-g0`). */
	key: string;
	label: string;
	runs: number;
	total: number;
};

/**
 * Spend per night over the last `count` nights, stacked by group: the chart
 * rows, the chart config, and the groups ranked by spend.
 */
export function spendPerNight(
	runs: RunSummary[],
	count: number,
	groupOf: (run: RunSummary) => string,
	now = Date.now(),
) {
	const nights = lastNights(count, now);
	const first = nights[0] ?? 0;
	const inRange = runs.filter((run) => nightOf(run.createdAt) >= first);

	const byLabel = new Map<string, { runs: number; total: number }>();
	for (const run of inRange) {
		const label = groupOf(run);
		const group = byLabel.get(label) ?? { runs: 0, total: 0 };
		group.runs += 1;
		group.total += run.costUsd;
		byLabel.set(label, group);
	}
	const ranked = [...byLabel.entries()].sort((a, b) => b[1].total - a[1].total);
	const top = ranked.slice(0, MAX_GROUPS);
	const rest = ranked.slice(MAX_GROUPS);
	const groups: SpendGroup[] = top.map(([label, group], index) => ({
		key: `g${index}`,
		label,
		...group,
	}));
	if (rest.length > 0) {
		groups.push({
			key: "other",
			label: `${rest.length} more`,
			runs: rest.reduce((sum, [, group]) => sum + group.runs, 0),
			total: rest.reduce((sum, [, group]) => sum + group.total, 0),
		});
	}
	const keyOf = (label: string) =>
		groups.find((group) => group.label === label)?.key ?? "other";

	const rows = nights.map((night) => {
		const row: Record<string, number | string> = {
			night,
			label: formatNightShort(night),
			title: formatNight(night),
		};
		for (const group of groups) row[group.key] = 0;
		for (const run of inRange) {
			if (nightOf(run.createdAt) !== night) continue;
			const key = keyOf(groupOf(run));
			row[key] = (row[key] as number) + run.costUsd;
		}
		return row;
	});

	const config = Object.fromEntries(
		groups.map((group, index) => [
			group.key,
			{
				label: group.label,
				color:
					group.key === "other"
						? "var(--muted-foreground)"
						: `var(--chart-${index + 1})`,
			},
		]),
	) satisfies ChartConfig;

	const total = inRange.reduce((sum, run) => sum + run.costUsd, 0);
	const nightsWithRuns = new Set(inRange.map((run) => nightOf(run.createdAt)))
		.size;

	return { rows, config, groups, inRange, total, nightsWithRuns };
}
