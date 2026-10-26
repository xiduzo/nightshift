import { cn } from "@nightshift/ui/lib/utils";
import { lazy, Suspense } from "react";

import type { RunStatusCounts } from "./run-statuses";

// The chart library is large and every page shows the sidebar: it loads after the page.
const RunsDonutChart = lazy(() =>
	import("./runs-donut-chart").then((m) => ({ default: m.RunsDonutChart })),
);

/** The donut of run statuses in the sidebar. An empty space of the same size shows until it loads. */
export function RunsDonut({
	runs,
	className,
}: {
	runs: RunStatusCounts;
	className?: string;
}) {
	return (
		<Suspense
			fallback={
				<span
					aria-hidden="true"
					className={cn("aspect-square size-4", className)}
				/>
			}
		>
			<RunsDonutChart runs={runs} className={className} />
		</Suspense>
	);
}
