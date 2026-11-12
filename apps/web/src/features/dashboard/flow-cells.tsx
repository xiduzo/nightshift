import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { type Machine, MachineBadge } from "@/features/devices";
import { RunBars } from "@/features/runs";
import type { FlowHealthRow, Spread } from "@/shared/api";
import {
	costEndsSentence,
	costHalfSentence,
	costWithTokens,
	formatCost,
	formatKnownCost,
	formatRelative,
	hoverTime,
	typicalCostSentence,
} from "@/shared/format";
import { LocalTime } from "@/shared/time";

/**
 * What a useful result costs: what all the flow's runs cost together,
 * divided by the runs people found useful. Under it, how many of the
 * answered runs were useful. An older Host sends nothing: a dash.
 */
export function UsefulCell({ useful }: { useful: FlowHealthRow["useful"] }) {
	if (!useful) return "—";
	const lines =
		useful.answered === 0
			? ["No answers yet.", 'Answer "Was this run useful?" on a finished run.']
			: useful.costPerUseful === null
				? [
						"No run was useful yet.",
						useful.answered === 1
							? "1 run has an answer."
							: `${useful.answered} runs have an answer.`,
					]
				: [
						"What all runs of this flow cost, divided by the useful runs.",
						`${useful.useful} of ${useful.answered} runs with an answer were useful.`,
					];
	return (
		<Tooltip>
			<TooltipTrigger
				render={<span className="inline-flex flex-col items-end gap-1" />}
			>
				<span
					className={
						useful.costPerUseful === null ? "text-muted-foreground" : "text-sm"
					}
				>
					{useful.costPerUseful === null
						? "—"
						: formatKnownCost(useful.costPerUseful)}
				</span>
				{useful.answered > 0 ? (
					<span className="text-muted-foreground text-xs">
						{useful.useful} of {useful.answered} useful
					</span>
				) : null}
			</TooltipTrigger>
			<TooltipContent className="flex flex-col items-start gap-0.5 tabular-nums">
				{lines.map((line) => (
					<span key={line}>{line}</span>
				))}
			</TooltipContent>
		</Tooltip>
	);
}

/** The computers the steps of a flow run on. Nothing when it names none. */
export function Needs({ machines }: { machines: Machine[] }) {
	if (machines.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
			<span>Needs</span>
			{machines.map((machine) => (
				<MachineBadge
					key={machine.name}
					machine={machine}
					label="Steps of this flow run here."
				/>
			))}
		</div>
	);
}

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

const PLOT_WIDTH = 96;
const PLOT_HEIGHT = 14;

/**
 * A box plot of what a finished run costs, with the median under it: the
 * whiskers reach the cheapest and the dearest run, the box holds the middle
 * half. Each plot runs from zero to the dearest run of its own flow: some
 * flows cost far more than others, and one shared scale would squash the
 * cheap ones flat. What the runs that did not finish spent goes in the
 * tooltip.
 */
export function CostCell({
	cost,
	tokenUse,
	unfinished,
	unknownCost,
	freeRuns,
}: {
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
	const x = (usd: number) =>
		cost.max > 0 ? 1 + (usd / cost.max) * (PLOT_WIDTH - 2) : 1;
	const mid = PLOT_HEIGHT / 2;
	return (
		<Tooltip>
			<TooltipTrigger
				render={<span className="inline-flex flex-col items-end gap-1" />}
			>
				<svg
					width={PLOT_WIDTH}
					height={PLOT_HEIGHT}
					viewBox={`0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}`}
					aria-hidden="true"
					className="shrink-0 overflow-visible"
				>
					<line
						x1={x(cost.min)}
						x2={x(cost.max)}
						y1={mid}
						y2={mid}
						className="stroke-muted-foreground"
						strokeWidth={1}
					/>
					{[cost.min, cost.max].map((usd, index) => (
						<line
							key={index}
							x1={x(usd)}
							x2={x(usd)}
							y1={mid - 3}
							y2={mid + 3}
							className="stroke-muted-foreground"
							strokeWidth={1}
						/>
					))}
					<rect
						x={x(cost.q1)}
						y={1}
						width={Math.max(x(cost.q3) - x(cost.q1), 1)}
						height={PLOT_HEIGHT - 2}
						rx={2}
						className="fill-chart-2/40 stroke-chart-2"
						strokeWidth={1}
					/>
					<line
						x1={x(cost.median)}
						x2={x(cost.median)}
						y1={1}
						y2={PLOT_HEIGHT - 1}
						className="stroke-foreground"
						strokeWidth={2}
					/>
				</svg>
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
