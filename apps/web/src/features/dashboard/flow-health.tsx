import { Button } from "@nightshift/ui/components/button";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { RunStatusIcon } from "@/features/runs";
import type { FlowHealthRow, Project, Spread } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	formatCost,
	formatDateTime,
	formatRelative,
	useNow,
} from "@/shared/format";
import { FlowHealthDialog } from "./flow-health-dialog";

/**
 * Each flow over the page's range: the status of its last runs, its runs
 * and how many finished, and what a finished run costs. A stopped run did
 * not finish, so it counts against it. A flow a Subflow node ran counts
 * too, inside the run that called it. A row opens the details of its flow.
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
					columns={flowHealthColumns(now, open)}
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

function flowHealthColumns(now: number, onOpen: (name: string) => void) {
	return column.columns([
		column.accessor("name", {
			header: "Flow",
			cell: ({ row }) => (
				<Button
					variant="link"
					size="xs"
					className="h-auto px-0 font-mono"
					onClick={() => onOpen(row.original.name)}
				>
					{row.original.name}
				</Button>
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
					unfinished={original.unfinished}
					unknownCost={original.unknownCost}
					freeRuns={original.freeRuns}
				/>
			),
			meta: {
				headClassName: "pr-6 text-right w-56",
				cellClassName: "pr-6 text-right tabular-nums",
			},
		}),
	]);
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
			<time
				dateTime={new Date(row.last.startedAt).toISOString()}
				title={formatDateTime(row.last.startedAt)}
				className="text-muted-foreground text-xs"
			>
				Last run {formatRelative(row.last.startedAt, now)}
			</time>
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
 * The median cost of a finished run, with a box plot of the spread: the
 * whiskers reach the cheapest and the dearest run, the box holds the middle
 * half. Each plot runs from zero to the dearest run of its own flow: some
 * flows cost far more than others, and one shared scale would squash the
 * cheap ones flat. What the runs that did not finish spent goes in the
 * tooltip.
 */
function CostCell({
	cost,
	unfinished,
	unknownCost,
	freeRuns,
}: {
	cost: Spread | null;
	unfinished: FlowHealthRow["unfinished"];
	unknownCost: number;
	freeRuns: number;
}) {
	const freeLine =
		freeRuns > 0 ? (
			<span>
				{freeRuns === 1
					? "1 finished run is left out: it used no agent, so it cost nothing."
					: `${freeRuns} finished runs are left out: they used no agent, so they cost nothing.`}
			</span>
		) : null;
	const unknownLine =
		unknownCost > 0 ? (
			<span>
				{unknownCost === 1
					? "1 finished run is left out: a step did not report its cost."
					: `${unknownCost} finished runs are left out: a step did not report its cost.`}
			</span>
		) : null;
	const unfinishedLine =
		unfinished.count > 0 ? (
			<span>
				{unfinished.count === 1
					? "1 run that did not finish"
					: `${unfinished.count} runs that did not finish`}{" "}
				spent {formatCost(unfinished.costUsd)}.
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
				render={<span className="inline-flex items-center justify-end gap-3" />}
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
				<span className="w-14">{formatCost(cost.median)}</span>
			</TooltipTrigger>
			<TooltipContent className="flex flex-col items-start gap-0.5 tabular-nums">
				<span>A finished run typically costs {formatCost(cost.median)}.</span>
				{cost.count > 1 ? (
					<>
						<span>
							Half of them cost {formatCost(cost.q1)} to {formatCost(cost.q3)}.
						</span>
						<span>
							The cheapest cost {formatCost(cost.min)}, the most{" "}
							{formatCost(cost.max)}.
						</span>
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
