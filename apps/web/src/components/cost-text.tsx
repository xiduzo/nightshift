import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";

import { costNote, formatKnownCost, type KnownCost } from "@/lib/format";

/**
 * A cost as text. When part of it is estimated or not known, a dotted
 * underline says there is more, and the tooltip says what.
 */
export function CostText({
	cost,
	className,
}: {
	cost: KnownCost;
	className?: string;
}) {
	const text = formatKnownCost(cost);
	const note = costNote(cost);
	if (!note) return <span className={className}>{text}</span>;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span
						className={cn(
							"underline decoration-dotted underline-offset-4",
							className,
						)}
					/>
				}
			>
				{text}
			</TooltipTrigger>
			<TooltipContent>{note}</TooltipContent>
		</Tooltip>
	);
}
