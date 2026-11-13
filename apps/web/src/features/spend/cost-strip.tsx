import {
	type CostSteadiness,
	type SpendFlow,
	steadinessHint,
	steadinessLabel,
	timesUsual,
} from "@nightshift/client";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { formatCost } from "@/shared/format";
import { SpreadStrip, STEADINESS_TONE } from "@/shared/spread-strip";

/** Each steadiness, the steadiest first: the order of the legend. */
const STEADINESS_ORDER: CostSteadiness[] = ["steady", "varies", "unsteady"];

/**
 * What the runs of a flow cost against a usual run of that flow: the box
 * holds the middle half of the runs, the bar marks a usual run (1×), and
 * the dot is the dearest run. Every strip has the same scale, in times a
 * usual run, so a short strip means a steady cost whatever the flow costs.
 * The colour says how steady the cost is.
 */
export function CostStrip({ flow }: { flow: SpendFlow }) {
	const { usual, steadiness } = flow;
	if (!usual || !steadiness) {
		return (
			<span className="text-muted-foreground text-xs">
				{usual ? "Too few runs to compare" : "No finished run with a cost"}
			</span>
		);
	}
	return (
		<Tooltip>
			<TooltipTrigger render={<span className="block w-full" />}>
				<SpreadStrip spread={usual} steadiness={steadiness} />
			</TooltipTrigger>
			<TooltipContent className="flex flex-col items-start gap-0.5 tabular-nums">
				<span className="font-medium">
					{steadinessLabel(steadiness)}. {steadinessHint(steadiness)}
				</span>
				<span>A usual run costs {formatCost(usual.median)}.</span>
				<span>
					Most runs cost {formatCost(usual.q1)} to {formatCost(usual.q3)}.
				</span>
				<span>
					The most costly run cost {formatCost(usual.max)}:{" "}
					{timesUsual(usual.max, usual.median)} a usual run.
				</span>
				<span className="text-muted-foreground">
					From {usual.count} finished runs.
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

/** What the colours and the marks of a strip mean. */
export function CostStripLegend() {
	return (
		<div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-muted-foreground text-xs">
			{STEADINESS_ORDER.map((steadiness) => (
				<Tooltip key={steadiness}>
					<TooltipTrigger
						render={<span className="flex items-center gap-1.5" />}
					>
						<span
							className={cn(
								"size-2 rounded-xs",
								STEADINESS_TONE[steadiness].fill,
							)}
							aria-hidden="true"
						/>
						{steadinessLabel(steadiness)}
					</TooltipTrigger>
					<TooltipContent>{steadinessHint(steadiness)}</TooltipContent>
				</Tooltip>
			))}
			<span className="h-3 w-px bg-border" aria-hidden="true" />
			<span className="flex items-center gap-1.5">
				<span className="h-3 w-[3px] bg-muted-foreground" aria-hidden="true" />
				Usual run
			</span>
			<span className="flex items-center gap-1.5">
				<span
					className="h-2 w-4 rounded-sm bg-muted-foreground opacity-35"
					aria-hidden="true"
				/>
				Most runs
			</span>
			<span className="flex items-center gap-1.5">
				<span
					className="size-2 rounded-full bg-muted-foreground"
					aria-hidden="true"
				/>
				Most costly run
			</span>
		</div>
	);
}
