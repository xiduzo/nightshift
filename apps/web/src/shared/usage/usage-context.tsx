import { Button } from "@nightshift/ui/components/button";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@nightshift/ui/components/hover-card";
import type { ReactNode } from "react";

import { formatTokens } from "@/shared/format";

/** The tokens an agent used. `inputTokens` counts the cached ones too. */
export type TokenUsage = {
	inputTokens: number;
	outputTokens: number;
	/** The part of `inputTokens` read from the prompt cache. */
	cacheReadTokens?: number;
	/** The part of `inputTokens` written to the prompt cache. */
	cacheWriteTokens?: number;
};

/**
 * The AI Elements Context: a small button with the tokens used, and a
 * hover card that splits them into input, output and cache, with the cost.
 * There is no bar for the context window: no harness says how large it is.
 */
export function UsageContext({
	usage,
	cost,
	size = "sm",
}: {
	usage: TokenUsage;
	/** What the tokens cost, as it should read (a `CostText`, `formatCost(…)`). */
	cost?: ReactNode;
	size?: "xs" | "sm";
}) {
	const total = usage.inputTokens + usage.outputTokens;
	const rows: { label: string; value: number; part?: true }[] = [
		{ label: "Input", value: usage.inputTokens },
	];
	if (usage.cacheReadTokens) {
		rows.push({
			label: "Read from cache",
			value: usage.cacheReadTokens,
			part: true,
		});
	}
	if (usage.cacheWriteTokens) {
		rows.push({
			label: "Written to cache",
			value: usage.cacheWriteTokens,
			part: true,
		});
	}
	rows.push({ label: "Output", value: usage.outputTokens });

	return (
		<HoverCard>
			<HoverCardTrigger
				delay={10}
				closeDelay={100}
				render={
					<Button variant="outline" size={size} className="tabular-nums" />
				}
			>
				{formatTokens(total)}
				<span className="sr-only"> tokens</span>
			</HoverCardTrigger>
			<HoverCardContent className="flex w-64 flex-col gap-3">
				<div className="flex items-center justify-between gap-3 text-sm">
					<span className="font-medium">Tokens</span>
					<span className="text-muted-foreground tabular-nums">
						{total.toLocaleString("en-US")}
					</span>
				</div>
				<dl className="flex flex-col gap-1.5 text-xs">
					{rows.map((row) => (
						<div
							key={row.label}
							className={
								row.part
									? "flex justify-between gap-3 pl-3 text-muted-foreground"
									: "flex justify-between gap-3"
							}
						>
							<dt className={row.part ? undefined : "text-muted-foreground"}>
								{row.label}
							</dt>
							<dd className="tabular-nums">
								{row.value.toLocaleString("en-US")}
							</dd>
						</div>
					))}
					{cost !== undefined ? (
						<div className="flex justify-between gap-3 border-t pt-1.5">
							<dt className="text-muted-foreground">Cost</dt>
							<dd className="tabular-nums">{cost}</dd>
						</div>
					) : null}
				</dl>
			</HoverCardContent>
		</HoverCard>
	);
}
