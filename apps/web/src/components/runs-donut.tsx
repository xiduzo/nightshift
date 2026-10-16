import {
	type ChartConfig,
	ChartContainer,
} from "@nightshift/ui/components/chart";
import { cn } from "@nightshift/ui/lib/utils";
import { Pie, PieChart } from "recharts";

import type { RunStatus, RunSummary } from "@/lib/api-types";

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
	running: { label: "Running", color: "var(--status-running)" },
	waiting: { label: "Waiting for you", color: "var(--status-waiting)" },
	sleeping: { label: "Sleeping", color: "var(--status-sleeping)" },
	finished: { label: "Finished", color: "var(--status-finished)" },
	failed: { label: "Failed", color: "var(--status-failed)" },
	interrupted: { label: "Interrupted", color: "var(--status-interrupted)" },
	stopped: { label: "Stopped", color: "var(--status-stopped)" },
} satisfies ChartConfig;

/** How many runs have each status, in a fixed order, without the empty ones. */
export function countRunStatuses(runs: RunSummary[]) {
	return ORDER.flatMap((status) => {
		const count = runs.filter((run) => run.status === status).length;
		return count > 0 ? [{ status, count, fill: `var(--color-${status})` }] : [];
	});
}

/** One line for screen readers and tooltips: "3 runs: 2 finished, 1 failed". */
export function describeRunStatuses(runs: RunSummary[]) {
	const counts = countRunStatuses(runs);
	const total = `${runs.length} ${runs.length === 1 ? "run" : "runs"}`;
	if (counts.length === 0) return total;
	return `${total}: ${counts
		.map(
			({ status, count }) =>
				`${count} ${RUN_STATUS_CHART[status].label.toLowerCase()}`,
		)
		.join(", ")}`;
}

/** A donut of run statuses, after the shadcn `chart-pie-donut` block. Small enough for a sidebar badge. */
export function RunsDonut({
	runs,
	className,
}: {
	runs: RunSummary[];
	className?: string;
}) {
	return (
		<ChartContainer
			config={RUN_STATUS_CHART}
			initialDimension={{ width: 16, height: 16 }}
			className={cn("aspect-square size-4", className)}
			aria-hidden="true"
		>
			{/* Recharts keeps a 5px margin by default; at 16px that leaves a dot. */}
			<PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
				<Pie
					data={countRunStatuses(runs)}
					dataKey="count"
					nameKey="status"
					innerRadius="50%"
					outerRadius="100%"
					strokeWidth={0}
					isAnimationActive={false}
				/>
			</PieChart>
		</ChartContainer>
	);
}
