import { HEALTH_NIGHTS } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import { Progress } from "@nightshift/ui/components/progress";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import { RunStatusBadge } from "@/features/runs";
import type {
	DashboardSummary,
	FlowHealthRow,
	Project,
	Spread,
} from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	formatCost,
	formatDateTime,
	formatRelative,
	useNow,
} from "@/shared/format";
import { PageSection } from "@/shared/page";
import { FlowHealthDialog } from "./flow-health-dialog";
import { OVERVIEW_ROWS } from "./overview";

/**
 * Each flow over the last 30 nights: its last run, how often it finished, and
 * what a finished run costs. A stopped run did not finish, so it counts
 * against it. A flow a Subflow node ran counts too, inside the run that
 * called it. A row opens the details of its flow.
 */
export function FlowHealth({
	project,
	summary,
}: {
	project: Project;
	/** Undefined while it loads. */
	summary: DashboardSummary | undefined;
}) {
	const now = useNow(60_000);
	const health = summary?.flowHealth;
	// The name stays while the dialog closes, so its body does not go blank.
	const [details, setDetails] = useState<{ name: string; open: boolean }>();

	if (health && health.count === 0) return null;

	return (
		<PageSection
			title="Flow health"
			description={`The ${OVERVIEW_ROWS} busiest flows over the last ${HEALTH_NIGHTS} nights, on their own or as a subflow.`}
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
					{!health ? (
						<div className="flex flex-col gap-2 px-6 py-4">
							<Skeleton className="h-9 w-full" />
							<Skeleton className="h-9 w-full" />
						</div>
					) : (
						<FlowHealthTable
							// The busiest flows, then the one that ran last.
							rows={health.rows}
							now={now}
							onOpen={(name) => setDetails({ name, open: true })}
						/>
					)}
				</CardContent>
			</Card>
			{details ? (
				<FlowHealthDialog
					open={details.open}
					onOpenChange={(open) => setDetails({ ...details, open })}
					flowName={details.name}
					project={project}
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
	return (
		<DataTable
			columns={flowHealthColumns(now, onOpen)}
			data={rows}
			getRowId={(row) => row.name}
			onRowClick={(row) => onOpen(row.name)}
		/>
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
		// Null (none ended) sorts like a missing value: last.
		column.accessor((row) => row.rate ?? undefined, {
			id: "rate",
			header: "Finished",
			enableSorting: true,
			sortUndefined: "last",
			cell: ({ row: { original } }) =>
				original.rate === null ? (
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
