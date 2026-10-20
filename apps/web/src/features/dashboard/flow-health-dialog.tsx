import { Button } from "@nightshift/ui/components/button";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import { DialogFooter } from "@nightshift/ui/components/dialog";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ReferenceLine,
	XAxis,
	YAxis,
} from "recharts";
import { RunStatusBadge } from "@/features/runs";
import type { Project, RunStatus, RunSummary } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	formatCost,
	formatDateTime,
	formatDuration,
	formatKnownCost,
	formatRelative,
	sumKnownCost,
	useNow,
} from "@/shared/format";
import {
	ChartSection,
	DetailsDialog,
	DetailsEmpty,
	DetailsHeader,
	DetailsTabContent,
	DetailsTabs,
	MoreRows,
	type NightRange,
	NightRangeToggle,
	Stat,
	Swatch,
} from "./details";
import {
	type FlowRun,
	finishedCostOf,
	hasEnded,
	runsOf,
	spreadOf,
} from "./flow-runs";
import {
	formatNight,
	formatNightShort,
	inLastNights,
	lastNights,
	nightOf,
} from "./nights";
import { OVERVIEW_ROWS } from "./overview";
import { RUN_STATUS_CHART } from "./runs-donut";

type Tab = "overview" | "cost" | "problems" | "runs";

/**
 * One flow in detail, behind its Flow health row, in tabs so each view stays
 * small: an overview with runs per night, what each run cost against the
 * median, why runs did not finish, and the latest runs. One range drives
 * every tab. Runs as a subflow count, as in the row.
 */
export function FlowHealthDialog({
	open,
	onOpenChange,
	flowName,
	project,
	runs,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	flowName: string;
	project: Project;
	runs: RunSummary[];
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<FlowHealthDetails
				flowName={flowName}
				project={project}
				runs={runs}
				onNavigate={() => onOpenChange(false)}
			/>
		</DetailsDialog>
	);
}

function FlowHealthDetails({
	flowName,
	project,
	runs,
	onNavigate,
}: {
	flowName: string;
	project: Project;
	runs: RunSummary[];
	onNavigate: () => void;
}) {
	const now = useNow(60_000);
	const [range, setRange] = useState<NightRange>(30);
	const [tab, setTab] = useState<Tab>("overview");
	const inRange = runsOf(flowName, runs)
		.filter((run) => inLastNights(run.startedAt, range, now))
		.sort((a, b) => a.startedAt - b.startedAt);
	const asSubflow = inRange.filter((run) => run.calledBy !== null).length;
	const ended = inRange.filter(hasEnded);
	const finished = ended.filter((run) => run.status === "finished");
	const unfinished = ended.filter((run) => run.status !== "finished");
	const { cost } = finishedCostOf(finished);
	const warnings = inRange.reduce(
		(total, run) => total + run.warnings.length,
		0,
	);
	const length = spreadOf(
		finished.flatMap((run) =>
			run.endedAt === null ? [] : [run.endedAt - run.startedAt],
		),
	);
	const spent = sumKnownCost(inRange);
	const spentUnfinished = sumKnownCost(unfinished);

	const dearest = ended.reduce<FlowRun | undefined>(
		(top, run) => (top === undefined || run.costUsd > top.costUsd ? run : top),
		undefined,
	);

	return (
		<>
			<DetailsHeader project={project} trail="Flow health" title={flowName} />

			<DetailsTabs
				tabs={[
					{ value: "overview", label: "Overview" },
					{ value: "cost", label: "Cost" },
					{
						value: "problems",
						label: "Problems",
						count: unfinished.length + warnings,
					},
					{ value: "runs", label: "Runs" },
				]}
				value={tab}
				onValueChange={setTab}
				toggle={<NightRangeToggle value={range} onValueChange={setRange} />}
			>
				{inRange.length === 0 ? (
					<DetailsEmpty>
						This flow did not run in the last {range} nights.
					</DetailsEmpty>
				) : (
					<>
						<DetailsTabContent value="overview">
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
								<Stat
									label="Runs"
									value={String(inRange.length)}
									hint={
										asSubflow > 0
											? `${asSubflow} as a subflow`
											: "All on its own"
									}
								/>
								<Stat
									label="Finished"
									value={
										ended.length > 0
											? `${Math.round((finished.length / ended.length) * 100)}%`
											: "—"
									}
									hint={`${finished.length} of ${ended.length} ended runs`}
								/>
								<Stat
									label="Per finished run"
									value={cost ? formatCost(cost.median) : "—"}
									hint={
										cost && cost.count > 1
											? `Half cost ${formatCost(cost.q1)} to ${formatCost(cost.q3)}`
											: undefined
									}
								/>
								<Stat
									label="Typical length"
									value={length ? formatDuration(length.median) : "—"}
									hint={
										length && length.count > 1
											? `Half take ${formatDuration(length.q1)} to ${formatDuration(length.q3)}`
											: undefined
									}
								/>
							</div>
							<RunsPerNight runs={inRange} range={range} now={now} />
						</DetailsTabContent>

						<DetailsTabContent value="cost">
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
								<Stat label="Spent in all" value={formatKnownCost(spent)} />
								<Stat
									label="Not finished"
									value={formatKnownCost(spentUnfinished)}
									hint={
										unfinished.length === 1
											? "Spent by 1 run"
											: `Spent by ${unfinished.length} runs`
									}
								/>
								<Stat
									label="Dearest run"
									value={dearest ? formatCost(dearest.costUsd) : "—"}
									hint={dearest ? formatDateTime(dearest.startedAt) : undefined}
								/>
							</div>
							<CostPerRun runs={ended} median={cost?.median} />
						</DetailsTabContent>

						<DetailsTabContent value="problems">
							{unfinished.length + warnings === 0 ? (
								<DetailsEmpty>
									Every run in the last {range} nights finished, without
									warnings.
								</DetailsEmpty>
							) : null}
							{unfinished.length > 0 ? (
								<WhyUnfinished runs={unfinished} now={now} />
							) : null}
							{warnings > 0 ? (
								<Warnings runs={inRange} now={now} onNavigate={onNavigate} />
							) : null}
						</DetailsTabContent>

						<DetailsTabContent value="runs">
							<LatestRuns
								runs={inRange.slice(-OVERVIEW_ROWS).reverse()}
								now={now}
								onNavigate={onNavigate}
							/>
						</DetailsTabContent>
					</>
				)}
			</DetailsTabs>

			<DialogFooter>
				<Button
					variant="outline"
					nativeButton={false}
					render={
						<Link
							to="/projects/$projectId/runs"
							params={{ projectId: project.id }}
							onClick={onNavigate}
						/>
					}
				>
					All runs
				</Button>
				<Button
					variant="outline"
					nativeButton={false}
					render={
						<Link
							to="/projects/$projectId/flows/$name"
							params={{ projectId: project.id, name: flowName }}
							onClick={onNavigate}
						/>
					}
				>
					Open flow
					<ArrowRightIcon data-icon="inline-end" />
				</Button>
			</DialogFooter>
		</>
	);
}

/** Runs per night, stacked by status, like the Runs details. */
function RunsPerNight({
	runs,
	range,
	now,
}: {
	runs: FlowRun[];
	range: NightRange;
	now: number;
}) {
	const statuses = (Object.keys(RUN_STATUS_CHART) as RunStatus[]).filter(
		(status) => runs.some((run) => run.status === status),
	);
	const rows = lastNights(range, now).map((night) => {
		const row: Record<string, number | string> = {
			label: formatNightShort(night),
			title: formatNight(night),
		};
		for (const status of statuses) row[status] = 0;
		for (const run of runs) {
			if (nightOf(run.startedAt) === night) {
				row[run.status] = (row[run.status] as number) + 1;
			}
		}
		return row;
	});
	const config = Object.fromEntries(
		statuses.map((status) => [status, RUN_STATUS_CHART[status]]),
	);
	return (
		<ChartSection
			title="History"
			hint="Runs per night, noon to noon, by status"
		>
			<ChartContainer config={config} className="aspect-auto h-48 w-full">
				<BarChart data={rows} margin={{ left: 0, right: 0 }}>
					<CartesianGrid vertical={false} />
					<XAxis
						dataKey="label"
						tickLine={false}
						axisLine={false}
						tickMargin={8}
						minTickGap={24}
					/>
					<YAxis
						tickLine={false}
						axisLine={false}
						width={32}
						allowDecimals={false}
					/>
					<ChartTooltip
						cursor={false}
						content={
							<ChartTooltipContent
								labelFormatter={(_, payload) =>
									String(payload[0]?.payload?.title ?? "")
								}
								formatter={(value, name) => (
									<div className="flex w-full items-center gap-2">
										<Swatch color={`var(--color-${name})`} />
										<span className="text-muted-foreground">
											{RUN_STATUS_CHART[name as RunStatus]?.label ?? name}
										</span>
										<span className="ml-auto font-medium font-mono tabular-nums">
											{Number(value)}
										</span>
									</div>
								)}
							/>
						}
					/>
					{statuses.map((status, index) => (
						<Bar
							key={status}
							dataKey={status}
							stackId="runs"
							fill={`var(--color-${status})`}
							radius={
								index === statuses.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]
							}
						/>
					))}
				</BarChart>
			</ChartContainer>
		</ChartSection>
	);
}

/**
 * One bar per ended run, oldest first, in the color of how it ended. The
 * dashed line is the median of the finished runs, so a dear run stands out.
 */
function CostPerRun({
	runs,
	median,
}: {
	runs: FlowRun[];
	median: number | undefined;
}) {
	const rows = runs.map((run, index) => ({
		key: `${run.runId}-${index}`,
		label: formatNightShort(nightOf(run.startedAt)),
		title: formatDateTime(run.startedAt),
		costUsd: run.costUsd,
		status: run.status,
	}));
	const config = Object.fromEntries(
		[...new Set(runs.map((run) => run.status))].map((status) => [
			status,
			RUN_STATUS_CHART[status],
		]),
	);
	return (
		<ChartSection
			title="Cost per run"
			hint={
				median === undefined
					? "Each ended run, oldest first"
					: `Each ended run, oldest first. The dashed line is the median of the finished runs that used an agent, ${formatCost(median)}.`
			}
		>
			{runs.length === 0 ? (
				<DetailsEmpty>No run has ended yet.</DetailsEmpty>
			) : (
				<ChartContainer config={config} className="aspect-auto h-48 w-full">
					<BarChart data={rows} margin={{ left: 0, right: 0 }}>
						<CartesianGrid vertical={false} />
						<XAxis
							dataKey="key"
							tickFormatter={(_, index) => rows[index]?.label ?? ""}
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							minTickGap={24}
						/>
						<YAxis
							tickLine={false}
							axisLine={false}
							width={48}
							tickFormatter={(value: number) => `$${value.toFixed(2)}`}
						/>
						<ChartTooltip
							cursor={false}
							content={
								<ChartTooltipContent
									labelFormatter={(_, payload) =>
										String(payload[0]?.payload?.title ?? "")
									}
									formatter={(value, _, item) => {
										const status = item.payload?.status as RunStatus;
										return (
											<div className="flex w-full items-center gap-2">
												<Swatch color={`var(--color-${status})`} />
												<span className="text-muted-foreground">
													{RUN_STATUS_CHART[status]?.label ?? status}
												</span>
												<span className="ml-auto font-medium font-mono tabular-nums">
													{formatCost(Number(value))}
												</span>
											</div>
										);
									}}
								/>
							}
						/>
						{median !== undefined ? (
							<ReferenceLine
								y={median}
								strokeDasharray="4 4"
								className="stroke-muted-foreground"
							/>
						) : null}
						<Bar dataKey="costUsd" radius={[4, 4, 0, 0]}>
							{rows.map((row) => (
								<Cell key={row.key} fill={`var(--color-${row.status})`} />
							))}
						</Bar>
					</BarChart>
				</ChartContainer>
			)}
		</ChartSection>
	);
}

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
function Warnings({
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
function WhyUnfinished({ runs, now }: { runs: FlowRun[]; now: number }) {
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
function LatestRuns({
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
