import { ChartContainer } from "@nightshift/ui/components/chart";
import { cn } from "@nightshift/ui/lib/utils";
import { Pie, PieChart } from "recharts";

import type { RunSummary } from "@/shared/api";

import { countRunStatuses, RUN_STATUS_CHART } from "./run-statuses";

/** A donut of run statuses, after the shadcn `chart-pie-donut` block. Small enough for a sidebar badge. */
export function RunsDonutChart({
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
