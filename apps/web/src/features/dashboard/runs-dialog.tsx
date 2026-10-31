import { finishedShare } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import {
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "@nightshift/ui/components/chart";
import { DialogFooter } from "@nightshift/ui/components/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Link } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { RunStatusBadge } from "@/features/runs";
import type {
	DashboardSummary,
	NightRange,
	NightsRange,
	Project,
	RunStatus,
} from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { formatRelative, useNow } from "@/shared/format";
import {
	ChartSection,
	DetailsDialog,
	DetailsEmpty,
	DetailsHeader,
	DetailsTabContent,
	DetailsTabs,
	MoreRows,
	NightRangeToggle,
	Stat,
	Swatch,
} from "./details";
import { nightChartRows } from "./nights";
import { nightsOf } from "./ranges";
import { RUN_STATUS_CHART } from "./run-statuses";

type Tab = "overview" | "groups" | "failed";

/**
 * How runs went, in detail, in tabs like Flow health: runs per night stacked
 * by status, the share that finished per flow (or per project over all of
 * them), and the latest failures. One range drives every tab. Behind the
 * "Runs, last 24 h" card.
 */
export function RunsDialog({
	open,
	onOpenChange,
	summary,
	project,
	initialRange,
	initialTab,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	summary: DashboardSummary;
	/** One project; otherwise all of them. */
	project?: Project;
	/** The range it opens at: the page's. Default 30 nights. */
	initialRange?: NightRange;
	/** The tab it opens at. Default Overview. */
	initialTab?: Tab;
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<RunsDetails
				summary={summary}
				project={project}
				onNavigate={() => onOpenChange(false)}
				initialRange={initialRange}
				initialTab={initialTab}
			/>
		</DetailsDialog>
	);
}

function RunsDetails({
	summary,
	project,
	onNavigate,
	initialRange = 30,
	initialTab = "overview",
}: {
	summary: DashboardSummary;
	project?: Project;
	onNavigate: () => void;
	initialRange?: NightRange;
	initialTab?: Tab;
}) {
	const now = useNow(60_000);
	const [range, setRange] = useState<NightRange>(initialRange);
	const [tab, setTab] = useState<Tab>(initialTab);
	const lastDay = summary.cards.lastDay;
	const inRange: NightsRange["runs"] = nightsOf(summary, range).runs;
	const { ended, finished, nightsWithRuns, groups, failed } = inRange;
	// Only the statuses that occur, in the donut's order: live first.
	const statuses = inRange.statuses.map(({ status }) => status);
	const rows = nightChartRows(inRange.perNight);
	const config = Object.fromEntries(
		statuses.map((status) => [status, RUN_STATUS_CHART[status]]),
	);

	return (
		<>
			<DetailsHeader project={project} trail="Runs" title="Runs" />

			<DetailsTabs
				tabs={[
					{ value: "overview", label: "Overview" },
					{ value: "groups", label: project ? "By flow" : "By project" },
					{ value: "failed", label: "Failed", count: failed.count },
				]}
				value={tab}
				onValueChange={setTab}
				toggle={
					<NightRangeToggle
						ranges={summary.nights.map((n) => n.nights)}
						value={range}
						onValueChange={setRange}
					/>
				}
			>
				<DetailsTabContent value="overview">
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<Stat
							label="Last 24 h"
							value={String(lastDay.runs)}
							hint={
								lastDay.runs === 0
									? "No runs in the last day"
									: `${lastDay.finished} finished, ${lastDay.failed} failed`
							}
						/>
						<Stat
							label="Runs"
							value={String(inRange.runs)}
							hint={`Last ${range} nights`}
						/>
						<Stat
							label="Finished"
							value={
								finishedShare(finished, ended) === null
									? "—"
									: `${finishedShare(finished, ended)}%`
							}
							hint={`${finished} of ${ended} ended runs`}
						/>
						<Stat
							label="Per night"
							value={
								nightsWithRuns > 0
									? (inRange.runs / nightsWithRuns).toFixed(1)
									: "—"
							}
							hint="Nights with runs"
						/>
					</div>

					<ChartSection
						title="History"
						hint="Runs per night, noon to noon, by status"
					>
						{inRange.runs === 0 ? (
							<DetailsEmpty>No runs in the last {range} nights.</DetailsEmpty>
						) : (
							<ChartContainer
								config={config}
								className="aspect-auto h-56 w-full"
							>
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
															{RUN_STATUS_CHART[name as RunStatus]?.label ??
																name}
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
												index === statuses.length - 1
													? [4, 4, 0, 0]
													: [0, 0, 0, 0]
											}
										/>
									))}
								</BarChart>
							</ChartContainer>
						)}
					</ChartSection>
				</DetailsTabContent>

				<DetailsTabContent value="groups">
					<ChartSection
						title={project ? "Runs per flow" : "Runs per project"}
						hint={`The top ${groups.rows.length}, the most runs first`}
					>
						{groups.count === 0 ? (
							<DetailsEmpty>No runs in the last {range} nights.</DetailsEmpty>
						) : (
							<>
								<DataTable
									columns={groupColumns(project ? "Flow" : "Project")}
									data={groups.rows}
									getRowId={(group) => group.label}
								/>
								<MoreRows
									hidden={groups.count - groups.rows.length}
									where={project ? "flows" : "projects"}
								/>
							</>
						)}
					</ChartSection>
				</DetailsTabContent>

				<DetailsTabContent value="failed">
					<ChartSection
						title="Failed runs"
						hint={`The last ${failed.rows.length}, newest first`}
					>
						{failed.count === 0 ? (
							<DetailsEmpty>
								No run failed in the last {range} nights.
							</DetailsEmpty>
						) : (
							<>
								<ItemGroup className="gap-1">
									{failed.rows.map((run) => (
										<Item
											key={run.id}
											size="xs"
											render={
												<Link
													to="/runs/$runId"
													params={{ runId: run.id }}
													onClick={onNavigate}
												/>
											}
										>
											<ItemContent className="min-w-0">
												<ItemTitle className="w-full truncate">
													{run.title}
												</ItemTitle>
												<ItemDescription className="truncate">
													{project ? null : `${run.group}, `}
													{formatRelative(run.createdAt, now)}
													{run.reason ? `: ${run.reason}` : null}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<RunStatusBadge status={run.status} />
											</ItemActions>
										</Item>
									))}
								</ItemGroup>
								<MoreRows
									hidden={failed.count - failed.rows.length}
									where="failed runs"
								/>
							</>
						)}
					</ChartSection>
				</DetailsTabContent>
			</DetailsTabs>

			{project ? (
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
						<ArrowRightIcon data-icon="inline-end" />
					</Button>
				</DialogFooter>
			) : null}
		</>
	);
}

type GroupRow = NightsRange["runs"]["groups"]["rows"][number];

const groupColumn = dataTableColumns<GroupRow>();

/** How runs went per flow or project. */
function groupColumns(groupLabel: string) {
	const count = {
		headClassName: "text-right",
		cellClassName: "text-right tabular-nums",
	};
	return groupColumn.columns([
		groupColumn.accessor("label", {
			header: groupLabel,
			meta: { cellClassName: "max-w-48 truncate font-mono text-xs" },
		}),
		groupColumn.accessor("runs", {
			header: "Runs",
			enableSorting: true,
			meta: count,
		}),
		groupColumn.accessor("finished", {
			header: "Finished",
			enableSorting: true,
			meta: count,
		}),
		groupColumn.accessor("failed", {
			header: "Failed",
			enableSorting: true,
			meta: count,
		}),
		groupColumn.accessor((group) => group.finished / group.runs, {
			id: "share",
			header: "Finished share",
			enableSorting: true,
			cell: ({ getValue }) => `${Math.round(getValue() * 100)}%`,
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right font-medium tabular-nums",
			},
		}),
	]);
}
