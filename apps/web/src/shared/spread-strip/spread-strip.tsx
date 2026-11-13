import type { CostSteadiness } from "@nightshift/client";
import { cn } from "@nightshift/ui/lib/utils";

import type { Spread } from "@/shared/api";

/** The strip ends at this many times a usual run. A larger run sits on its end. */
export const STRIP_TIMES = 6;

/** The colour of each steadiness, as a fill, as text and as a tint: the status tokens. */
export const STEADINESS_TONE: Record<
	CostSteadiness,
	{ fill: string; text: string; tint: string }
> = {
	steady: {
		fill: "bg-status-finished",
		text: "text-status-finished",
		tint: "bg-status-finished/15",
	},
	varies: {
		fill: "bg-status-waiting",
		text: "text-status-waiting",
		tint: "bg-status-waiting/15",
	},
	unsteady: {
		fill: "bg-status-failed",
		text: "text-status-failed",
		tint: "bg-status-failed/15",
	},
};

/**
 * The runs of a flow against a usual run of that flow, for what a run
 * costs or how long it takes: the box holds the middle half of the runs,
 * the bar marks a usual run (1×), and the dot is the largest run. Every
 * strip has the same scale, in times a usual run, so a short strip means
 * steady runs whatever the flow costs or takes. The colour says how
 * steady: grey while Night Shift cannot say yet.
 */
export function SpreadStrip({
	spread,
	steadiness,
	className,
}: {
	spread: Spread;
	steadiness: CostSteadiness | null | undefined;
	className?: string;
}) {
	const fill = steadiness
		? STEADINESS_TONE[steadiness].fill
		: "bg-muted-foreground";
	const times = (value: number) =>
		spread.median > 0 ? Math.min(value / spread.median, STRIP_TIMES) : 0;
	const at = (value: number) => `${(times(value) / STRIP_TIMES) * 100}%`;
	const width = (from: number, to: number) =>
		`${(times(to) - times(from)) * (100 / STRIP_TIMES)}%`;
	return (
		<span
			className={cn("relative block h-5 w-full", className)}
			aria-hidden="true"
		>
			<span className="absolute inset-x-0 top-1/2 h-px bg-border" />
			<span
				className={cn("absolute top-1/2 h-px", fill)}
				style={{ left: at(spread.min), width: width(spread.min, spread.max) }}
			/>
			<span
				className={cn(
					"absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm opacity-35",
					fill,
				)}
				style={{ left: at(spread.q1), width: width(spread.q1, spread.q3) }}
			/>
			<span
				className={cn(
					"absolute top-1/2 h-3.5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-[1px]",
					fill,
				)}
				style={{ left: at(spread.median) }}
			/>
			{spread.max > spread.q3 ? (
				<span
					className={cn(
						"absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full",
						fill,
					)}
					style={{ left: at(spread.max) }}
				/>
			) : null}
		</span>
	);
}
