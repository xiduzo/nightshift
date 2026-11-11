import { neededReasonsText, neededShare } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
	type Machine,
	MachineBadge,
	neededMachines,
	useSpaceMachines,
} from "@/features/devices";
import { RunStatusIcon } from "@/features/runs";
import type { FlowHealthRow, Project, Spread } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	costEndsSentence,
	costHalfSentence,
	costWithTokens,
	formatCost,
	formatKnownCost,
	formatRelative,
	typicalCostSentence,
	useNow,
} from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { FlowHealthDialog } from "./flow-health-dialog";
import { projectFlowsQuery } from "./queries";

/**
 * Each flow over the page's range: the status of its last runs, its runs
 * and how many finished, what a finished run costs, what a useful result
 * costs, and how often its runs needed you. A stopped run did not finish,
 * so it counts against it. A
 * flow a Subflow node ran counts too, inside the run that called it. Under
 * its name: the computers its steps need. A row opens the details of its
 * flow.
 */
export function FlowHealthTable({
	project,
	rows,
}: {
	project: Project;
	/** Undefined while they load. */
	rows: FlowHealthRow[] | undefined;
}) {
	const now = useNow(60_000);
	// The name stays while the dialog closes, so its body does not go blank.
	const [details, setDetails] = useState<{ name: string; open: boolean }>();
	const open = (name: string) => setDetails({ name, open: true });
	const flows = useQuery(projectFlowsQuery(project.id));
	const machines = useSpaceMachines();
	// The run's own computer is the one you start it on: only what the flow names.
	const needs = useMemo(() => {
		const out = new Map<string, Machine[]>();
		if (!machines) return out;
		for (const flow of flows.data ?? []) {
			out.set(flow.name, neededMachines(machines, false, flow.devices));
		}
		return out;
	}, [flows.data, machines]);

	return (
		<>
			{!rows ? (
				<div className="flex flex-col gap-2 px-6 py-4">
					<Skeleton className="h-9 w-full" />
					<Skeleton className="h-9 w-full" />
				</div>
			) : (
				<DataTable
					// The busiest flows, then the one that ran last.
					columns={flowHealthColumns(now, open, needs)}
					data={rows}
					getRowId={(row) => row.name}
					onRowClick={(row) => open(row.name)}
				/>
			)}
			{details ? (
				<FlowHealthDialog
					open={details.open}
					onOpenChange={(open) => setDetails({ ...details, open })}
					flowName={details.name}
					project={project}
				/>
			) : null}
		</>
	);
}

const column = dataTableColumns<FlowHealthRow>();

function flowHealthColumns(
	now: number,
	onOpen: (name: string) => void,
	needs: ReadonlyMap<string, Machine[]>,
) {
	return column.columns([
		column.accessor("name", {
			header: "Flow",
			cell: ({ row: { original } }) => (
				<div className="flex flex-col items-start gap-1">
					<Button
						variant="link"
						size="xs"
						className="h-auto px-0 font-mono"
						onClick={() => onOpen(original.name)}
					>
						{original.name}
					</Button>
					<Needs machines={needs.get(original.name) ?? []} />
				</div>
			),
			meta: { headClassName: "pl-6", cellClassName: "pl-6" },
		}),
		column.accessor((row) => row.last?.startedAt, {
			id: "last",
			header: "Last runs",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row: { original } }) => <LastRuns row={original} now={now} />,
		}),
		column.accessor("runs", {
			header: "Runs",
			enableSorting: true,
			cell: ({ row: { original } }) => <RunsCell row={original} />,
			meta: { headClassName: "w-56" },
		}),
		column.accessor((row) => row.cost?.median, {
			id: "perRun",
			header: "Per finished run",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row: { original } }) => (
				<CostCell
					cost={original.cost}
					tokenUse={original.tokenUse}
					unfinished={original.unfinished}
					unknownCost={original.unknownCost}
					freeRuns={original.freeRuns}
				/>
			),
			meta: {
				headClassName: "text-right w-56",
				cellClassName: "text-right tabular-nums",
			},
		}),
		column.accessor((row) => row.useful?.costPerUseful?.costUsd, {
			id: "perUseful",
			header: "Per useful result",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row: { original } }) => <UsefulCell useful={original.useful} />,
			meta: {
				headClassName: "text-right w-40",
				cellClassName: "text-right tabular-nums",
			},
		}),
		column.accessor((row) => neededOf(row.neededYou) ?? undefined, {
			id: "neededYou",
			header: "Needed you",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row: { original } }) => (
				<NeededYouCell neededYou={original.neededYou} />
			),
			meta: {
				headClassName: "pr-6 text-right w-32",
				cellClassName: "pr-6 text-right tabular-nums",
			},
		}),
	]);
}

/** The share of a flow's own runs that needed you. Null without runs, or from an older Host. */
function neededOf(neededYou: FlowHealthRow["neededYou"]): number | null {
	return neededYou
		? neededShare({ runs: neededYou.runs, neededYou: neededYou.needed })
		: null;
}

/**
 * How often a person stepped in on the flow's own runs, as a share, and
 * why in the tooltip. An older Host sends nothing: a dash.
 */
function NeededYouCell({
	neededYou,
}: {
	neededYou: FlowHealthRow["neededYou"];
}) {
	const share = neededOf(neededYou);
	if (!neededYou || share === null) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<Tooltip>
			<TooltipTrigger
				render={<span className="inline-flex flex-col items-end gap-1" />}
			>
				<span className="text-sm">{share}%</span>
				<span className="text-muted-foreground text-xs">
					{neededYou.needed} of {neededYou.runs}{" "}
					{neededYou.runs === 1 ? "run" : "runs"}
				</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-64 tabular-nums">
				{neededYou.needed === 0
					? "Every run of this flow ran without you."
					: neededReasonsText(neededYou.reasons)}
			</TooltipContent>
		</Tooltip>
	);
}

/**
 * What a useful result costs: what all the flow's runs cost together,
 * divided by the runs people found useful. Under it, how many of the
 * answered runs were useful. An older Host sends nothing: a dash.
 */
function UsefulCell({ useful }: { useful: FlowHealthRow["useful"] }) {
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
function Needs({ machines }: { machines: Machine[] }) {
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

/** The status of the last runs, newest first, and when the last one started. */
function LastRuns({ row, now }: { row: FlowHealthRow; now: number }) {
	if (!row.last) {
		return <span className="text-muted-foreground text-xs">Never run</span>;
	}
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-0.5">
				{row.lastRuns.map((run) => (
					<Link
						key={run.runId}
						to="/runs/$runId"
						params={{ runId: run.runId }}
						// The row opens the flow; an icon opens its run.
						onClick={(event) => event.stopPropagation()}
						className="rounded-sm p-0.5 hover:bg-muted"
					>
						<RunStatusIcon status={run.status} />
					</Link>
				))}
			</div>
			<LocalTime
				at={row.last.startedAt}
				className="text-muted-foreground text-xs"
			>
				Last run {formatRelative(row.last.startedAt, now)}
			</LocalTime>
		</div>
	);
}

/** Its runs, and under it how many of those that ended finished. */
function RunsCell({ row }: { row: FlowHealthRow }) {
	return (
		<div
			className="flex flex-col gap-1"
			title={`${row.finished} of ${row.ended} ended runs finished. A stopped run did not finish.`}
		>
			<span className="text-sm tabular-nums">
				{row.runs} {row.runs === 1 ? "run" : "runs"}
			</span>
			{row.rate === null ? (
				<span className="text-muted-foreground text-xs">None ended yet</span>
			) : (
				<span className="text-muted-foreground text-xs tabular-nums">
					{row.rate}% finished
				</span>
			)}
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
function CostCell({
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
