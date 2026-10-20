/** The tables of a flow's health: its warnings, why runs did not finish, and the latest runs. */
import { Button } from "@nightshift/ui/components/button";
import { Link, useNavigate } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { RunStatusBadge } from "@/features/runs";
import type { RunStatus } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	formatCost,
	formatDateTime,
	formatDuration,
	formatRelative,
} from "@/shared/format";
import { ChartSection, MoreRows } from "./details";
import type { FlowRun } from "./flow-runs";
import { OVERVIEW_ROWS } from "./overview";
import { RUN_STATUS_CHART } from "./runs-donut";

type WarningRow = {
	key: string;
	nodeId: string | null;
	message: string;
	/** The runs that warned this, each counted once. */
	runs: number;
	last: { runId: string; at: number };
};

/**
 * The warnings of the runs, grouped by node and message, the most common
 * first: a warning many runs share is a systematic problem, not bad luck.
 */
export function Warnings({
	runs,
	now,
	onNavigate,
}: {
	runs: FlowRun[];
	now: number;
	onNavigate: () => void;
}) {
	const byKey = new Map<string, WarningRow & { runIds: Set<string> }>();
	for (const run of runs) {
		for (const warning of run.warnings) {
			const key = `${warning.nodeId ?? ""}\u0000${warning.message}`;
			const row = byKey.get(key) ?? {
				key,
				nodeId: warning.nodeId,
				message: warning.message,
				runs: 0,
				runIds: new Set<string>(),
				last: { runId: run.runId, at: warning.at },
			};
			row.runIds.add(run.runId);
			row.runs = row.runIds.size;
			if (warning.at >= row.last.at)
				row.last = { runId: run.runId, at: warning.at };
			byKey.set(key, row);
		}
	}
	const rows = [...byKey.values()].sort((a, b) => b.runs - a.runs);
	return (
		<ChartSection
			title="Warnings"
			hint={`The top ${Math.min(rows.length, OVERVIEW_ROWS)}, the most common first`}
		>
			<DataTable
				columns={warningColumns(now, onNavigate)}
				data={rows.slice(0, OVERVIEW_ROWS)}
				getRowId={(row) => row.key}
			/>
			<MoreRows hidden={rows.length - OVERVIEW_ROWS} where="warnings" />
		</ChartSection>
	);
}

const warningColumn = dataTableColumns<WarningRow>();

function warningColumns(now: number, onNavigate: () => void) {
	return warningColumn.columns([
		warningColumn.accessor("message", {
			header: "Warning",
			cell: ({ row: { original } }) => (
				<span className="flex min-w-0 items-start gap-2">
					<TriangleAlertIcon
						className="mt-0.5 size-3.5 shrink-0 text-status-waiting"
						aria-hidden="true"
					/>
					<span className="whitespace-normal text-xs">
						{original.nodeId ? (
							<span className="font-medium font-mono">{original.nodeId}: </span>
						) : null}
						{original.message}
					</span>
				</span>
			),
		}),
		warningColumn.accessor("runs", {
			header: "Runs",
			enableSorting: true,
			meta: {
				headClassName: "text-right w-16",
				cellClassName: "text-right tabular-nums",
			},
		}),
		warningColumn.accessor((row) => row.last.at, {
			id: "last",
			header: "Last",
			enableSorting: true,
			cell: ({ row: { original } }) => (
				<span className="flex items-center gap-2">
					<time
						dateTime={new Date(original.last.at).toISOString()}
						title={formatDateTime(original.last.at)}
						className="text-muted-foreground text-xs"
					>
						{formatRelative(original.last.at, now)}
					</time>
					<Button
						variant="link"
						size="xs"
						className="h-auto px-0"
						nativeButton={false}
						aria-label={"Open run, the last run with this warning"}
						render={
							<Link
								to="/runs/$runId"
								params={{ runId: original.last.runId }}
								onClick={onNavigate}
							/>
						}
					>
						Open run
					</Button>
				</span>
			),
			meta: { headClassName: "w-44" },
		}),
	]);
}

type ReasonRow = {
	reason: string;
	status: RunStatus;
	runs: number;
	last: FlowRun;
};

/** The runs that did not finish, grouped by why, the most common first. */
export function WhyUnfinished({ runs, now }: { runs: FlowRun[]; now: number }) {
	const byReason = new Map<string, ReasonRow>();
	for (const run of runs) {
		const reason =
			run.reason ??
			(run.calledBy !== null
				? `${RUN_STATUS_CHART[run.status].label} inside ${run.calledBy}`
				: RUN_STATUS_CHART[run.status].label);
		const row = byReason.get(reason);
		byReason.set(reason, {
			reason,
			status: run.status,
			runs: (row?.runs ?? 0) + 1,
			// Runs come oldest first: the latest one wins.
			last: run,
		});
	}
	const rows = [...byReason.values()].sort((a, b) => b.runs - a.runs);
	return (
		<ChartSection
			title="Why runs did not finish"
			hint={`The top ${Math.min(rows.length, OVERVIEW_ROWS)}, the most common first`}
		>
			<DataTable
				columns={reasonColumns(now)}
				data={rows.slice(0, OVERVIEW_ROWS)}
				getRowId={(row) => row.reason}
			/>
			<MoreRows hidden={rows.length - OVERVIEW_ROWS} where="reasons" />
		</ChartSection>
	);
}

const reasonColumn = dataTableColumns<ReasonRow>();

function reasonColumns(now: number) {
	return reasonColumn.columns([
		reasonColumn.accessor("reason", {
			header: "Reason",
			cell: ({ row: { original } }) => (
				<span className="flex min-w-0 items-center gap-2">
					<RunStatusBadge status={original.status} />
					<span className="whitespace-normal text-xs">{original.reason}</span>
				</span>
			),
		}),
		reasonColumn.accessor("runs", {
			header: "Runs",
			enableSorting: true,
			meta: {
				headClassName: "text-right w-16",
				cellClassName: "text-right tabular-nums",
			},
		}),
		reasonColumn.accessor((row) => row.last.startedAt, {
			id: "last",
			header: "Last",
			enableSorting: true,
			cell: ({ row: { original } }) => (
				<time
					dateTime={new Date(original.last.startedAt).toISOString()}
					title={formatDateTime(original.last.startedAt)}
					className="text-muted-foreground text-xs"
				>
					{formatRelative(original.last.startedAt, now)}
				</time>
			),
			meta: { headClassName: "w-28" },
		}),
	]);
}

type LatestRow = FlowRun & { key: string };

/** The latest runs, newest first. A click on a row opens its run. */
export function LatestRuns({
	runs,
	now,
	onNavigate,
}: {
	runs: FlowRun[];
	now: number;
	onNavigate: () => void;
}) {
	const navigate = useNavigate();
	return (
		<ChartSection
			title="Latest runs"
			hint={`The last ${Math.min(runs.length, OVERVIEW_ROWS)}, newest first`}
		>
			<DataTable
				columns={latestColumns(now, onNavigate)}
				data={runs.map((run, index) => ({
					...run,
					key: `${run.runId}-${run.startedAt}-${index}`,
				}))}
				getRowId={(row: LatestRow) => row.key}
				onRowClick={(row) => {
					onNavigate();
					navigate({ to: "/runs/$runId", params: { runId: row.runId } });
				}}
			/>
		</ChartSection>
	);
}

const latestColumn = dataTableColumns<LatestRow>();

function latestColumns(now: number, onNavigate: () => void) {
	return latestColumn.columns([
		latestColumn.accessor("startedAt", {
			header: "Started",
			cell: ({ row: { original } }) => (
				<span className="flex items-center gap-2">
					<RunStatusBadge status={original.status} />
					{/* The row opens the run on a click. This link does it for the keyboard. */}
					<Button
						variant="link"
						size="xs"
						className="h-auto px-0 font-normal text-muted-foreground"
						nativeButton={false}
						aria-label={`Open run, started ${formatDateTime(original.startedAt)}`}
						render={
							<Link
								to="/runs/$runId"
								params={{ runId: original.runId }}
								onClick={(event) => {
									event.stopPropagation();
									onNavigate();
								}}
							/>
						}
					>
						<time
							dateTime={new Date(original.startedAt).toISOString()}
							title={formatDateTime(original.startedAt)}
						>
							{formatRelative(original.startedAt, now)}
						</time>
					</Button>
				</span>
			),
		}),
		latestColumn.accessor("calledBy", {
			header: "How",
			cell: ({ row: { original } }) => (
				<span className="text-muted-foreground text-xs">
					{original.calledBy === null
						? "On its own"
						: `Subflow of ${original.calledBy}`}
				</span>
			),
		}),
		latestColumn.accessor(
			(row) => (row.endedAt === null ? undefined : row.endedAt - row.startedAt),
			{
				id: "length",
				header: "Length",
				cell: ({ getValue }) => {
					const ms = getValue();
					return ms === undefined ? "—" : formatDuration(ms);
				},
				meta: {
					headClassName: "text-right",
					cellClassName: "text-right tabular-nums text-xs",
				},
			},
		),
		latestColumn.accessor("costUsd", {
			header: "Cost",
			cell: ({ getValue }) => formatCost(getValue()),
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right tabular-nums text-xs",
			},
		}),
	]);
}
