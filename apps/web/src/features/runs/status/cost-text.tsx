import { tokensLabel, type UsageTokens } from "@nightshift/client";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";

import { costNote, formatKnownCost, type KnownCost } from "@/shared/format";

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

/** A cost with the tokens that made it, when any were used. */
export function CostWithTokens({
	cost,
	tokens,
	className,
}: {
	cost: KnownCost;
	tokens?: UsageTokens | number | null;
	className?: string;
}) {
	const used = tokensLabel(tokens);
	return (
		<span className={cn("inline-flex items-baseline gap-1", className)}>
			{used ? (
				<>
					<span>{used}</span>
					<span aria-hidden="true">·</span>
				</>
			) : null}
			<CostText cost={cost} />
		</span>
	);
}
