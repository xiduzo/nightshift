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

import { DataTable, dataTableColumns } from "@/components/data-table";
import { RunStatusBadge } from "@/components/run-status-badge";
import { countRunStatuses, RUN_STATUS_CHART } from "@/components/runs-donut";
import { useNow } from "@/hooks/use-now";
import type { Project, RunStatus, RunSummary } from "@/lib/api-types";
import { formatRelative } from "@/lib/format";
import {
	formatNight,
	formatNightShort,
	inLastNights,
	lastNights,
	nightOf,
} from "@/lib/nights";
import { OVERVIEW_ROWS } from "@/lib/overview";

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
import { spendGroupOf } from "./spend";

const DAY_MS = 24 * 60 * 60 * 1000;
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
	runs,
	project,
	projects,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	runs: RunSummary[];
	/** One project; otherwise all of them. */
	project?: Project;
	/** To name the project of each run, over all projects. */
	projects?: Project[];
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<RunsDetails
				runs={runs}
				project={project}
				projects={projects}
				onNavigate={() => onOpenChange(false)}
			/>
		</DetailsDialog>
	);
}

function RunsDetails({
	runs,
	project,
	projects,
	onNavigate,
}: {
	runs: RunSummary[];
	project?: Project;
	projects?: Project[];
	onNavigate: () => void;
}) {
	const now = useNow(60_000);
	const [range, setRange] = useState<NightRange>(30);
	const [tab, setTab] = useState<Tab>("overview");
	const groupOf = spendGroupOf(project, projects);
	const lastDay = runs.filter((run) => run.createdAt >= now - DAY_MS);
	const inRange = runs.filter((run) => inLastNights(run.createdAt, range, now));
	const ended = inRange.filter(
		(run) => run.status === "finished" || run.status === "failed",
	);
	const finished = ended.filter((run) => run.status === "finished");
	const nightsWithRuns = new Set(inRange.map((run) => nightOf(run.createdAt)))
		.size;

	// Only the statuses that occur, in the donut's order: live first.
	const statuses = countRunStatuses(inRange).map(({ status }) => status);
	const rows = lastNights(range, now).map((night) => {
		const row: Record<string, number | string> = {
			label: formatNightShort(night),
			title: formatNight(night),
		};
		for (const status of statuses) row[status] = 0;
		for (const run of inRange) {
			if (nightOf(run.createdAt) === night) {
				row[run.status] = (row[run.status] as number) + 1;
			}
		}
		return row;
	});
	const config = Object.fromEntries(
		statuses.map((status) => [status, RUN_STATUS_CHART[status]]),
	);

	const byGroup = new Map<string, RunSummary[]>();
	for (const run of inRange) {
		byGroup.set(groupOf(run), [...(byGroup.get(groupOf(run)) ?? []), run]);
	}
	const groups = [...byGroup.entries()]
		.map(([label, ofGroup]) => ({
			label,
			runs: ofGroup.length,
			finished: ofGroup.filter((run) => run.status === "finished").length,
			failed: ofGroup.filter((run) => run.status === "failed").length,
		}))
		.sort((a, b) => b.runs - a.runs);
	const failed = inRange
		.filter((run) => run.status === "failed")
		.sort((a, b) => b.createdAt - a.createdAt);
	const lastDayFinished = lastDay.filter(
		(run) => run.status === "finished",
	).length;
	const lastDayFailed = lastDay.filter((run) => run.status === "failed").length;

	return (
		<>
			<DetailsHeader project={project} trail="Runs" title="Runs" />

			<DetailsTabs
				tabs={[
					{ value: "overview", label: "Overview" },
					{ value: "groups", label: project ? "By flow" : "By project" },
					{ value: "failed", label: "Failed", count: failed.length },
				]}
				value={tab}
				onValueChange={setTab}
				toggle={<NightRangeToggle value={range} onValueChange={setRange} />}
			>
				<DetailsTabContent value="overview">
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<Stat
							label="Last 24 h"
							value={String(lastDay.length)}
							hint={
								lastDay.length === 0
									? "No runs in the last day"
									: `${lastDayFinished} finished, ${lastDayFailed} failed`
							}
						/>
						<Stat
							label="Runs"
							value={String(inRange.length)}
							hint={`Last ${range} nights`}
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
							label="Per night"
							value={
								nightsWithRuns > 0
									? (inRange.length / nightsWithRuns).toFixed(1)
									: "—"
							}
							hint="Nights with runs"
						/>
					</div>

					<ChartSection
						title="History"
						hint="Runs per night, noon to noon, by status"
					>
						{inRange.length === 0 ? (
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
						hint={`The top ${Math.min(groups.length, OVERVIEW_ROWS)}, the most runs first`}
					>
						{groups.length === 0 ? (
							<DetailsEmpty>No runs in the last {range} nights.</DetailsEmpty>
						) : (
							<>
								<DataTable
									columns={groupColumns(project ? "Flow" : "Project")}
									data={groups.slice(0, OVERVIEW_ROWS)}
									getRowId={(group) => group.label}
								/>
								<MoreRows
									hidden={groups.length - OVERVIEW_ROWS}
									where={project ? "flows" : "projects"}
								/>
							</>
						)}
					</ChartSection>
				</DetailsTabContent>

				<DetailsTabContent value="failed">
					<ChartSection
						title="Failed runs"
						hint={`The last ${Math.min(failed.length, OVERVIEW_ROWS)}, newest first`}
					>
						{failed.length === 0 ? (
							<DetailsEmpty>
								No run failed in the last {range} nights.
							</DetailsEmpty>
						) : (
							<>
								<ItemGroup className="gap-1">
									{failed.slice(0, OVERVIEW_ROWS).map((run) => (
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
													{project ? null : `${groupOf(run)}, `}
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
									hidden={failed.length - OVERVIEW_ROWS}
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

type GroupRow = {
	label: string;
	runs: number;
	finished: number;
	failed: number;
};

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
