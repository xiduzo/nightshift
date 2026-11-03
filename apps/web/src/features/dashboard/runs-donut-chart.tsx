import { ChartContainer } from "@nightshift/ui/components/chart";
import { cn } from "@nightshift/ui/lib/utils";
import { Pie, PieChart } from "recharts";

import {
	countRunStatuses,
	RUN_STATUS_CHART,
	type RunStatusCounts,
} from "./run-statuses";

/** Without runs the donut is one gray ring. */
const NO_RUNS = [
	{
		status: "none",
		count: 1,
		fill: "color-mix(in oklch, var(--muted-foreground) 40%, transparent)",
	},
];

/** A donut of run statuses, after the shadcn `chart-pie-donut` block. Small enough for a sidebar badge. */
export function RunsDonutChart({
	runs,
	className,
}: {
	runs: RunStatusCounts;
	className?: string;
}) {
	const counts = countRunStatuses(runs);
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
					data={counts.length > 0 ? counts : NO_RUNS}
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
