import {
	type CostSteadiness,
	steadinessHint,
	steadinessLabel,
} from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";

/** The colour of each steadiness, as a fill and as text: the status tokens. */
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

/** How steady the cost of a flow is, with what that says about its runs on hover. */
export function SteadinessBadge({
	steadiness,
}: {
	steadiness: CostSteadiness;
}) {
	const tone = STEADINESS_TONE[steadiness];
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Badge
						variant="secondary"
						className={cn("shrink-0", tone.tint, tone.text)}
					/>
				}
			>
				{steadinessLabel(steadiness)}
			</TooltipTrigger>
			<TooltipContent>{steadinessHint(steadiness)}</TooltipContent>
		</Tooltip>
	);
}
