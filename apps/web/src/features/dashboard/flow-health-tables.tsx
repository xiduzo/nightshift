/** The tables of a flow's health: its warnings, why runs did not finish, and the latest runs. */
import { Button } from "@nightshift/ui/components/button";
import { Link, useNavigate } from "@tanstack/react-router";
import { TriangleAlertIcon } from "lucide-react";
import { RunStatusBadge } from "@/features/runs";
import type { FlowRange, FlowRun } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	formatCost,
	formatDateTime,
	formatDuration,
	formatRelative,
} from "@/shared/format";
import { ChartSection, MoreRows } from "./details";
import { RUN_STATUS_CHART } from "./run-statuses";

type WarningRow = FlowRange["warningRows"]["rows"][number];

/**
 * The warnings of the runs, grouped by node and message, the most common
 * first: a warning many runs share is a systematic problem, not bad luck.
 */
export function Warnings({
	warnings,
	now,
	onNavigate,
}: {
	warnings: FlowRange["warningRows"];
	now: number;
	onNavigate: () => void;
}) {
	return (
		<ChartSection
			title="Warnings"
			hint={`The top ${warnings.rows.length}, the most common first`}
		>
			<DataTable
				columns={warningColumns(now, onNavigate)}
				data={warnings.rows}
				getRowId={(row) => row.key}
			/>
			<MoreRows
				hidden={warnings.count - warnings.rows.length}
				where="warnings"
			/>
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

type ReasonRow = FlowRange["whyUnfinished"]["rows"][number];

/** Why a run did not finish: its own reason, else its status (and its caller). */
function reasonOf(row: ReasonRow): string {
	return (
		row.reason ??
		(row.calledBy !== null
			? `${RUN_STATUS_CHART[row.status].label} inside ${row.calledBy}`
			: RUN_STATUS_CHART[row.status].label)
	);
}

/** The runs that did not finish, grouped by why, the most common first. */
export function WhyUnfinished({
	reasons,
	now,
}: {
	reasons: FlowRange["whyUnfinished"];
	now: number;
}) {
	return (
		<ChartSection
			title="Why runs did not finish"
			hint={`The top ${reasons.rows.length}, the most common first`}
		>
			<DataTable
				columns={reasonColumns(now)}
				data={reasons.rows}
				getRowId={reasonOf}
			/>
			<MoreRows hidden={reasons.count - reasons.rows.length} where="reasons" />
		</ChartSection>
	);
}

const reasonColumn = dataTableColumns<ReasonRow>();

function reasonColumns(now: number) {
	return reasonColumn.columns([
		reasonColumn.accessor(reasonOf, {
			id: "reason",
			header: "Reason",
			cell: ({ row: { original } }) => (
				<span className="flex min-w-0 items-center gap-2">
					<RunStatusBadge status={original.status} />
					<span className="whitespace-normal text-xs">
						{reasonOf(original)}
					</span>
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
		reasonColumn.accessor("lastAt", {
			id: "last",
			header: "Last",
			enableSorting: true,
			cell: ({ row: { original } }) => (
				<time
					dateTime={new Date(original.lastAt).toISOString()}
					title={formatDateTime(original.lastAt)}
					className="text-muted-foreground text-xs"
				>
					{formatRelative(original.lastAt, now)}
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
			hint={`The last ${runs.length}, newest first`}
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
