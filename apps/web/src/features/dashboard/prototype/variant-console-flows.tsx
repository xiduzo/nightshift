/**
 * PROTOTYPE, throw away. The Flows tab of the Console: per flow, the status
 * of its last runs with the last one under them, its runs with how many
 * finished, and the box plot of what a finished run costs. Over the
 * page-wide range: each flow's own numbers per range.
 */

import { Button } from "@nightshift/ui/components/button";
import { Progress } from "@nightshift/ui/components/progress";
import { useQueries } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { RunStatusIcon } from "@/features/runs";
import type {
	DashboardSummary,
	FlowHealthRow,
	Project,
	RunStatus,
} from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { formatDateTime, formatRelative, useNow } from "@/shared/format";
import { CostCell } from "../flow-health";
import { FlowHealthDialog } from "../flow-health-dialog";
import { dashboardQueries } from "../queries";
import type { DashboardRange } from "./range-bar";

/** How many of a flow's last runs show as icons. */
const LAST_RUNS = 10;

type Row = FlowHealthRow & {
	/** Newest first. Undefined while the flow's numbers load. */
	lastRuns: { runId: string; status: RunStatus; startedAt: number }[] | null;
};

export function ConsoleFlows({
	project,
	summary,
	range,
}: {
	project: Project;
	summary: DashboardSummary;
	range: DashboardRange;
}) {
	const now = useNow(60_000);
	const [details, setDetails] = useState<{ name: string; open: boolean }>();
	const health = summary.flowHealth?.rows ?? [];
	const nights = range === "24h" ? 7 : range;
	const flows = useQueries({
		queries: health.map((row) => dashboardQueries.flow(project.id, row.name)),
	});

	const rows: Row[] = health.map((row, index) => {
		const detail = flows[index]?.data;
		if (!detail) return { ...row, lastRuns: null };
		// The longest range holds the most runs to show as icons.
		const widest = detail.ranges.at(-1);
		const seen = new Set<string>();
		const lastRuns = [...(widest?.latest ?? []), ...(widest?.endedRuns ?? [])]
			.filter((run) => !seen.has(run.runId) && Boolean(seen.add(run.runId)))
			.sort((a, b) => b.startedAt - a.startedAt)
			.slice(0, LAST_RUNS)
			.map(({ runId, status, startedAt }) => ({ runId, status, startedAt }));
		const inRange = detail.ranges.find((r) => r.nights === nights);
		if (!inRange || nights === summary.healthNights) {
			return { ...row, lastRuns };
		}
		return {
			...row,
			lastRuns,
			runs: inRange.runs,
			finished: inRange.finished,
			ended: inRange.ended,
			rate:
				inRange.ended === 0
					? null
					: Math.round((inRange.finished / inRange.ended) * 100),
			cost: inRange.cost,
			unfinished: {
				count: inRange.unfinished,
				costUsd: inRange.spentUnfinished.costUsd,
			},
			unknownCost: 0,
			freeRuns: 0,
		};
	});

	return (
		<>
			<DataTable
				columns={flowColumns(now, (name) => setDetails({ name, open: true }))}
				data={rows}
				getRowId={(row) => row.name}
				onRowClick={(row) => setDetails({ name: row.name, open: true })}
			/>
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

const column = dataTableColumns<Row>();

function flowColumns(now: number, onOpen: (name: string) => void) {
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
function LastRuns({ row, now }: { row: Row; now: number }) {
	if (!row.last) {
		return <span className="text-muted-foreground text-xs">Never run</span>;
	}
	const runs = row.lastRuns ?? [
		{
			runId: row.last.runId,
			status: row.last.status,
			startedAt: row.last.startedAt,
		},
	];
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-0.5">
				{runs.map((run) => (
					<Link
						key={run.runId}
						to="/runs/$runId"
						params={{ runId: run.runId }}
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

/** Runs, and below it how many of those that ended finished. */
function RunsCell({ row }: { row: Row }) {
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
				<span className="flex items-center gap-2">
					<Progress
						value={row.rate}
						aria-label={`${row.rate}% finished`}
						className="w-24"
					/>
					<span className="text-muted-foreground text-xs tabular-nums">
						{row.rate}% finished
					</span>
				</span>
			)}
		</div>
	);
}
