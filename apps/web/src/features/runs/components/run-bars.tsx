import { type StatusKey, statusOf } from "@nightshift/client";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import type { RunStatus, RunSummary } from "@/shared/api";

const BAR: Record<StatusKey, string> = {
	running: "bg-status-running motion-safe:animate-pulse",
	waiting: "bg-status-waiting",
	sleeping: "bg-status-sleeping",
	finished: "bg-status-finished",
	stopped: "bg-status-stopped",
	failed: "bg-status-failed",
	interrupted: "bg-status-interrupted",
	"nothing-to-do": "bg-muted-foreground/30",
};

/** One run in a `RunBars` row. */
export type RunBar = {
	runId: string;
	status: RunStatus;
	result?: RunSummary["result"];
	/** Goes after the status on hover, such as when it ran. */
	hint?: string;
};

/**
 * The last runs as a row of small bars, one per run, in the status
 * colour. Each bar opens its run. The status shows on hover and reaches
 * screen readers.
 */
export function RunBars({
	runs,
	className,
}: {
	runs: readonly RunBar[];
	className?: string;
}) {
	return (
		<div className={cn("flex flex-wrap items-center gap-0.75", className)}>
			{runs.map((run, index) => {
				const { key, word } = statusOf(run);
				const hover = [word, run.hint].filter(Boolean).join(" · ");
				return (
					<Tooltip
						// A run that calls the flow twice shows twice.
						key={`${run.runId}-${index}`}
					>
						<TooltipTrigger
							render={
								<Link
									to="/runs/$runId"
									params={{ runId: run.runId }}
									// Inside a row or card that opens something else, a bar opens only its run.
									onClick={(event) => event.stopPropagation()}
									className={cn(
										"h-4 w-2 rounded-[2px] outline-none transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-ring/50",
										BAR[key],
									)}
								/>
							}
						>
							<span className="sr-only">{hover}</span>
						</TooltipTrigger>
						<TooltipContent>{hover}</TooltipContent>
					</Tooltip>
				);
			})}
		</div>
	);
}
