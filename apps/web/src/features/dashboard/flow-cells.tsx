import { type CostSteadiness, timesUsual } from "@nightshift/client";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { RunBars } from "@/features/runs";
import type { FlowHealthRow, Spread } from "@/shared/api";
import {
	costEndsSentence,
	costHalfSentence,
	costWithTokens,
	formatCost,
	formatDuration,
	formatRelative,
	hoverTime,
	typicalCostSentence,
} from "@/shared/format";
import { SpreadStrip } from "@/shared/spread-strip";
import { LocalTime } from "@/shared/time";

/** The last runs as bars, oldest on the left, and when the last one started. */
export function LastRuns({ row, now }: { row: FlowHealthRow; now: number }) {
	if (!row.last) {
		return <span className="text-muted-foreground text-xs">Never run</span>;
	}
	return (
		<div className="flex flex-col gap-1">
			<RunBars
				runs={[...row.lastRuns].reverse().map((run) => ({
					runId: run.runId,
					status: run.status,
					hint: hoverTime(run.startedAt),
				}))}
			/>
			<LocalTime
				at={row.last.startedAt}
				className="text-muted-foreground text-xs"
			>
				Last run {formatRelative(row.last.startedAt, now)}
			</LocalTime>
		</div>
	);
}

/**
 * What a finished run costs against a usual run of the flow, as a strip
 * with the usual cost under it. Its colour says how steady the cost is.
 * What the runs that did not finish spent goes in the tooltip.
 */
export function CostCell({
	steadiness,
	cost,
	tokenUse,
	unfinished,
	unknownCost,
	freeRuns,
}: {
	/** Null: too few runs to say. Undefined: an older Host. */
	steadiness: CostSteadiness | null | undefined;
	cost: Spread | null;
	tokenUse: Spread | null;
	unfinished: FlowHealthRow["unfinished"];
	unknownCost: number;
	freeRuns: number;
}) {
	const freeLine =
		freeRuns > 0 ? (
			<span>
				{freeRuns === 1
					? "The cost does not include 1 finished run that used no agent."
					: `The cost does not include ${freeRuns} finished runs that used no agent.`}
			</span>
		) : null;
	const unknownLine =
		unknownCost > 0 ? (
			<span>
				{unknownCost === 1
					? "The cost does not include 1 finished run with an unknown cost."
					: `The cost does not include ${unknownCost} finished runs with an unknown cost.`}
			</span>
		) : null;
	const unfinishedLine =
		unfinished.count > 0 ? (
			<span>
				{unfinished.count === 1
					? "1 run that did not finish"
					: `${unfinished.count} runs that did not finish`}{" "}
				spent{" "}
				{costWithTokens(formatCost(unfinished.costUsd), unfinished.tokens)}.
			</span>
		) : null;
	if (cost === null) {
		return unfinishedLine || unknownLine || freeLine ? (
			<Tooltip>
				<TooltipTrigger render={<span className="text-muted-foreground" />}>
					—
				</TooltipTrigger>
				<TooltipContent className="flex flex-col items-start gap-0.5 tabular-nums">
					<span>No finished run with a known cost.</span>
					{freeLine}
					{unknownLine}
					{unfinishedLine}
				</TooltipContent>
			</Tooltip>
		) : (
			"—"
		);
	}
	return (
		<Tooltip>
			<TooltipTrigger render={<span className="flex flex-col gap-0.5" />}>
				<SpreadStrip spread={cost} steadiness={steadiness} />
				<span className="text-muted-foreground text-xs">
					{costWithTokens(formatCost(cost.median), tokenUse?.median)}
				</span>
			</TooltipTrigger>
			<TooltipContent className="flex flex-col items-start gap-0.5 tabular-nums">
				<span>{typicalCostSentence(cost.median, tokenUse)}</span>
				{cost.count > 1 ? (
					<>
						<span>{costHalfSentence(cost, tokenUse)}</span>
						<span>{costEndsSentence(cost, tokenUse)}</span>
					</>
				) : null}
				{freeLine}
				{unknownLine}
				{unfinishedLine}
				<span className="text-muted-foreground">
					{cost.count === 1
						? "From 1 finished run."
						: `From ${cost.count} finished runs.`}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}

/**
 * How long a finished run works against a usual run of the flow, as a
 * strip with the usual time under it. Its colour says how steady the time
 * is. A dash when no run finished, or from an older Host.
 */
export function TimeCell({
	steadiness,
	length,
}: {
	steadiness: CostSteadiness | null | undefined;
	length: Spread | null | undefined;
}) {
	if (!length) return <span className="text-muted-foreground">—</span>;
	return (
		<Tooltip>
			<TooltipTrigger render={<span className="flex flex-col gap-0.5" />}>
				<SpreadStrip spread={length} steadiness={steadiness} />
				<span className="text-muted-foreground text-xs">
					{formatDuration(length.median)}
				</span>
			</TooltipTrigger>
			<TooltipContent className="flex flex-col items-start gap-0.5 tabular-nums">
				<span>A usual run takes {formatDuration(length.median)}.</span>
				{length.count > 1 ? (
					<>
						<span>
							Most runs take {formatDuration(length.q1)} to{" "}
							{formatDuration(length.q3)}.
						</span>
						<span>
							The longest run took {formatDuration(length.max)}:{" "}
							{timesUsual(length.max, length.median)} a usual run.
						</span>
					</>
				) : null}
				<span className="text-muted-foreground">
					{length.count === 1
						? "From 1 finished run."
						: `From ${length.count} finished runs.`}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}
