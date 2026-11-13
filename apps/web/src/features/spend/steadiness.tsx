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
import { STEADINESS_TONE } from "@/shared/spread-strip";

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
