import { runStatusLabel } from "@nightshift/client";
import type { ChartConfig } from "@nightshift/ui/components/chart";

import type { RunStatus } from "@/shared/api";

/** Live statuses first, then how runs ended. */
const ORDER: RunStatus[] = [
	"running",
	"waiting",
	"sleeping",
	"finished",
	"failed",
	"interrupted",
	"stopped",
];

export const RUN_STATUS_CHART = {
	running: { label: runStatusLabel("running"), color: "var(--status-running)" },
	waiting: { label: runStatusLabel("waiting"), color: "var(--status-waiting)" },
	sleeping: {
		label: runStatusLabel("sleeping"),
		color: "var(--status-sleeping)",
	},
	finished: {
		label: runStatusLabel("finished"),
		color: "var(--status-finished)",
	},
	failed: { label: runStatusLabel("failed"), color: "var(--status-failed)" },
	interrupted: {
		label: runStatusLabel("interrupted"),
		color: "var(--status-interrupted)",
	},
	stopped: { label: runStatusLabel("stopped"), color: "var(--status-stopped)" },
} satisfies ChartConfig;

/** How many runs have each status, as a project's run counts say. */
export type RunStatusCounts = {
	total: number;
	statuses: Partial<Record<RunStatus, number>>;
};

/** How many runs have each status, in a fixed order, without the empty ones. */
export function countRunStatuses({ statuses }: RunStatusCounts) {
	return ORDER.flatMap((status) => {
		const count = statuses[status] ?? 0;
		return count > 0 ? [{ status, count, fill: `var(--color-${status})` }] : [];
	});
}

/** One line for screen readers and tooltips: "3 runs: 2 finished, 1 failed". */
export function describeRunStatuses(runs: RunStatusCounts) {
	const counts = countRunStatuses(runs);
	const total = `${runs.total} ${runs.total === 1 ? "run" : "runs"}`;
	if (counts.length === 0) return total;
	return `${total}: ${counts
		.map(
			({ status, count }) =>
				`${count} ${RUN_STATUS_CHART[status].label.toLowerCase()}`,
		)
		.join(", ")}`;
}
