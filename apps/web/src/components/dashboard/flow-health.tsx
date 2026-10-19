import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import { Progress } from "@nightshift/ui/components/progress";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import { DataTable, dataTableColumns } from "@/components/data-table";
import { PageSection } from "@/components/page-heading";
import { RunStatusBadge } from "@/components/run-status-badge";
import { useNow } from "@/hooks/use-now";
import type { Project, RunSummary } from "@/lib/api-types";
import { formatCost, formatDateTime, formatRelative } from "@/lib/format";
import { inLastNights } from "@/lib/nights";
import { orpc } from "@/utils/orpc";

import { FlowHealthDialog } from "./flow-health-dialog";
import {
	type FlowRun,
	hasEnded,
	runsOf,
	type Spread,
	spreadOf,
} from "./flow-runs";

const NIGHTS = 30;

/**
 * Each flow over the last 30 nights: its last run, how often it finished, and
 * what a finished run costs. A stopped run did not finish, so it counts
 * against it. A flow a Subflow node ran counts too, inside the run that
 * called it. A row opens the details of its flow.
 */
export function FlowHealth({
	project,
	runs,
}: {
	project: Project;
	runs: RunSummary[] | undefined;
}) {
	const now = useNow(60_000);
	const flows = useQuery(
		orpc.flows.list.queryOptions({ input: { projectId: project.id } }),
	);
	// The name stays while the dialog closes, so its body does not go blank.
	const [details, setDetails] = useState<{ name: string; open: boolean }>();

	if (!flows.isLoading && (flows.data?.length ?? 0) === 0) return null;

	return (
		<PageSection
			title="Flow health"
			description={`Each flow over the last ${NIGHTS} nights, on its own or as a subflow.`}
			actions={
				<Button
					variant="outline"
					size="sm"
					nativeButton={false}
					render={
						<Link
							to="/projects/$projectId/flows"
							params={{ projectId: project.id }}
						/>
					}
				>
					Flows
					<ArrowRightIcon data-icon="inline-end" />
				</Button>
			}
		>
			<Card className="py-0">
				<CardContent className="px-0">
					{flows.isLoading || !runs ? (
						<div className="flex flex-col gap-2 px-6 py-4">
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
						</div>
					) : (
						<FlowHealthTable
							rows={(flows.data ?? []).map((flow) =>
								flowHealthOf(flow.name, runs, now),
							)}
							now={now}
							onOpen={(name) => setDetails({ name, open: true })}
						/>
					)}
				</CardContent>
			</Card>
			{details && runs ? (
				<FlowHealthDialog
					open={details.open}
					onOpenChange={(open) => setDetails({ ...details, open })}
					flowName={details.name}
					project={project}
					runs={runs}
				/>
			) : null}
		</PageSection>
	);
}

function FlowHealthTable({
	rows,
	now,
	onOpen,
}: {
	rows: FlowHealthRow[];
	now: number;
	onOpen: (name: string) => void;
}) {
	// One scale for every row, so the costs of two flows compare at a glance.
	const scaleMax = Math.max(0, ...rows.map((row) => row.cost?.max ?? 0));
	return (
		<DataTable
			columns={flowHealthColumns(now, scaleMax, onOpen)}
			data={rows}
			getRowId={(row) => row.name}
			onRowClick={(row) => onOpen(row.name)}
		/>
	);
}

type FlowHealthRow = {
	name: string;
	last: FlowRun | undefined;
	/** Runs in the last nights. */
	runs: number;
	finished: number;
	ended: number;
	/** Percent of ended runs that finished; undefined when none ended. */
	rate: number | undefined;
	/** What a finished run cost; undefined when none finished. */
	cost: Spread | undefined;
	/** The runs that ended without finishing, and what they spent together. */
	unfinished: { count: number; costUsd: number };
	/** Finished runs with a step whose cost is not known: not in `cost`. */
	unknownCost: number;
};

function flowHealthOf(
	name: string,
	runs: RunSummary[],
	now: number,
): FlowHealthRow {
	const mine = runsOf(name, runs);
	const last = mine.reduce<FlowRun | undefined>(
		(latest, run) =>
			latest === undefined || run.startedAt > latest.startedAt ? run : latest,
		undefined,
	);
	const recent = mine.filter((run) => inLastNights(run.startedAt, NIGHTS, now));
	const ended = recent.filter(hasEnded);
	const finished = ended.filter((run) => run.status === "finished");
	// A run that failed early spent next to nothing, which would drag down
	// what a run costs. Its spend shows on its own instead.
	const unfinished = ended.filter((run) => run.status !== "finished");
	return {
		name,
		last,
		runs: recent.length,
		finished: finished.length,
		ended: ended.length,
		rate:
			ended.length > 0
				? Math.round((finished.length / ended.length) * 100)
				: undefined,
		// A run with a step of unknown cost would look cheaper than it was.
		cost: spreadOf(
			finished.filter((run) => run.costMissing === 0).map((run) => run.costUsd),
		),
		unknownCost: finished.filter((run) => run.costMissing > 0).length,
		unfinished: {
			count: unfinished.length,
			costUsd: unfinished.reduce((total, run) => total + run.costUsd, 0),
		},
	};
}

const column = dataTableColumns<FlowHealthRow>();

function flowHealthColumns(
	now: number,
	scaleMax: number,
	onOpen: (name: string) => void,
) {
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
			header: "Last run",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row: { original } }) =>
				original.last ? (
					<span className="flex items-center gap-2">
						<RunStatusBadge status={original.last.status} />
						<time
							dateTime={new Date(original.last.startedAt).toISOString()}
							title={formatDateTime(original.last.startedAt)}
							className="text-muted-foreground text-xs"
						>
							{formatRelative(original.last.startedAt, now)}
						</time>
					</span>
				) : (
					<span className="text-muted-foreground text-xs">Never run</span>
				),
		}),
		column.accessor("rate", {
			header: "Finished",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row: { original } }) =>
				original.rate === undefined ? (
					<span className="text-muted-foreground text-xs">—</span>
				) : (
					<span
						className="flex items-center gap-2"
						title={`${original.finished} of ${original.ended} finished. A stopped run did not finish.`}
					>
						<Progress
							value={original.rate}
							aria-label={`${original.rate}% finished`}
							className="w-24"
						/>
						<span className="text-xs tabular-nums">{original.rate}%</span>
					</span>
				),
			meta: { headClassName: "w-48" },
		}),
		column.accessor("runs", {
			header: "Runs",
			enableSorting: true,
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right tabular-nums",
			},
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
					scaleMax={scaleMax}
				/>
			),
			meta: {
				headClassName: "text-right w-56",
				cellClassName: "text-right tabular-nums",
			},
		}),
		column.display({
			id: "open",
			header: () => <span className="sr-only">Actions</span>,
			cell: ({ row: { original } }) =>
				original.last ? (
					<Button
						variant="link"
						size="xs"
						className="h-auto px-0"
						nativeButton={false}
						aria-label={`Open run, the last run of ${original.name}`}
						// The row opens the details. This button opens the run.
						onClick={(event) => event.stopPropagation()}
						render={
							<Link to="/runs/$runId" params={{ runId: original.last.runId }} />
						}
					>
						Open run
						<ArrowRightIcon data-icon="inline-end" />
					</Button>
				) : null,
			meta: { headClassName: "pr-6 w-28", cellClassName: "pr-6 text-right" },
		}),
	]);
}

const PLOT_WIDTH = 96;
const PLOT_HEIGHT = 14;

/**
 * The median cost of a finished run, with a box plot of the spread: the
 * whiskers reach the cheapest and the dearest run, the box holds the middle
 * half. What the runs that did not finish spent goes in the tooltip.
 */
function CostCell({
	cost,
	unfinished,
	unknownCost,
	scaleMax,
}: {
	cost: Spread | undefined;
	unfinished: FlowHealthRow["unfinished"];
	unknownCost: number;
	scaleMax: number;
}) {
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
	if (cost === undefined) {
		return unfinishedLine || unknownLine ? (
			<Tooltip>
				<TooltipTrigger render={<span className="text-muted-foreground" />}>
					—
				</TooltipTrigger>
				<TooltipContent className="flex flex-col items-start gap-0.5 tabular-nums">
					<span>No finished run with a known cost.</span>
					{unknownLine}
					{unfinishedLine}
				</TooltipContent>
			</Tooltip>
		) : (
			"—"
		);
	}
	const x = (usd: number) =>
		scaleMax > 0 ? 1 + (usd / scaleMax) * (PLOT_WIDTH - 2) : 1;
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
