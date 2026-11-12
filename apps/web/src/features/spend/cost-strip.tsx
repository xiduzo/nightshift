import { type SpendFlow, timesUsual } from "@nightshift/client";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { formatCost } from "@/shared/format";
import { STEADINESS_TONE } from "./steadiness";

/** The strip ends at this many times a usual run. A dearer run sits on its end. */
export const STRIP_TIMES = 6;

/** The marks of the scale over the strips: 0× to 6×. */
export const STRIP_MARKS = Array.from(
	{ length: STRIP_TIMES + 1 },
	(_, times) => times,
);

/**
 * What the runs of a flow cost against a usual run of that flow: the box
 * holds the middle half of the runs, the bar marks a usual run (1×), and
 * the dot is the dearest run. Every strip has the same scale, in times a
 * usual run, so a short strip means a steady cost whatever the flow costs.
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
	const tone = STEADINESS_TONE[steadiness];
	const at = (usd: number) =>
		`${Math.min(usd / usual.median / STRIP_TIMES, 1) * 100}%`;
	const width = (from: number, to: number) =>
		`${(Math.min(to / usual.median, STRIP_TIMES) - Math.min(from / usual.median, STRIP_TIMES)) * (100 / STRIP_TIMES)}%`;
	return (
		<Tooltip>
			<TooltipTrigger render={<span className="relative block h-5 w-full" />}>
				<span className="absolute inset-x-0 top-1/2 h-px bg-border" />
				<span
					className={cn("absolute top-1/2 h-px", tone.fill)}
					style={{ left: at(usual.min), width: width(usual.min, usual.max) }}
				/>
				<span
					className={cn(
						"absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm opacity-35",
						tone.fill,
					)}
					style={{ left: at(usual.q1), width: width(usual.q1, usual.q3) }}
				/>
				<span
					className={cn(
						"absolute top-1/2 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-[1px]",
						tone.fill,
					)}
					style={{ left: at(usual.median) }}
				/>
				{usual.max > usual.q3 ? (
					<span
						className={cn(
							"absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full",
							tone.fill,
						)}
						style={{ left: at(usual.max) }}
					/>
				) : null}
			</TooltipTrigger>
			<TooltipContent className="flex flex-col items-start gap-0.5 tabular-nums">
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

/** What the marks of a strip mean. */
export function CostStripLegend() {
	return (
		<div className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground text-xs">
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
