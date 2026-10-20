import { Button } from "@nightshift/ui/components/button";
import {
	type ChartConfig,
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
import type { Project, RunSummary } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	formatDayTime,
	formatDuration,
	formatRelative,
	formatTime,
	useNow,
} from "@/shared/format";
import { activePerHour, isOpen } from "./activity";
import {
	ChartSection,
	DetailsDialog,
	DetailsEmpty,
	DetailsHeader,
	DetailsTabContent,
	DetailsTabs,
	MoreRows,
	RangeToggle,
	Stat,
	Swatch,
} from "./details";
import { OVERVIEW_ROWS } from "./overview";
import { spendGroupOf } from "./spend";

/** In hours: a day, two, a week. */
const RANGES = [24, 48, 168] as const;
type Range = (typeof RANGES)[number];
type Tab = "overview" | "open" | "groups";
const CHART_CONFIG = {
	active: { label: "Runs at work", color: "var(--status-running)" },
} satisfies ChartConfig;

/**
 * What is at work, in detail, in tabs like Flow health: how many ran at once
 * per hour and the peak, the open runs, and which flows (or projects, over
 * all of them) kept Night Shift busy. Behind the "Running now" card.
 */
export function ActivityDialog({
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
			<ActivityDetails
				runs={runs}
				project={project}
				projects={projects}
				onNavigate={() => onOpenChange(false)}
			/>
		</DetailsDialog>
	);
}

function ActivityDetails({
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
	const [range, setRange] = useState<Range>(24);
	const [tab, setTab] = useState<Tab>("overview");
	const groupOf = spendGroupOf(project, projects);
	const hours = activePerHour(runs, range, now);
	const since = hours[0]?.hour ?? now;
	const peak = Math.max(0, ...hours.map((hour) => hour.active));
	const busy = hours.filter((hour) => hour.active > 0).length;
	const started = runs.filter((run) => run.createdAt >= since).length;
	const open = runs.filter(isOpen).sort((a, b) => a.createdAt - b.createdAt);
	const running = open.filter((run) => run.status === "running").length;
	const nextWake = open
		.flatMap((run) => (run.wakeAt ? [run.wakeAt] : []))
		.sort((a, b) => a - b)[0];
	const rows = hours.map(({ hour, active }) => ({
		active,
		label:
			range > 48
				? new Date(hour).toLocaleDateString(undefined, { weekday: "short" })
				: formatTime(hour),
		title: formatDayTime(hour),
	}));
	const rangeWord = range > 48 ? "7 days" : `${range} h`;
	const groups = atWorkPerGroup(runs, groupOf, since, now);

	return (
		<>
			<DetailsHeader project={project} trail="Runs" title="Activity" />

			<DetailsTabs
				tabs={[
					{ value: "overview", label: "Overview" },
					{ value: "open", label: "Open runs", count: open.length },
					{ value: "groups", label: project ? "By flow" : "By project" },
				]}
				value={tab}
				onValueChange={setTab}
				toggle={
					<RangeToggle
						ranges={RANGES}
						value={range}
						onValueChange={setRange}
						short={(hours) => (hours > 48 ? "7d" : `${hours}h`)}
						long={(hours) =>
							hours > 48 ? "Last 7 days" : `Last ${hours} hours`
						}
					/>
				}
			>
				<DetailsTabContent value="overview">
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<Stat
							label="Running now"
							value={String(running)}
							hint={
								nextWake
									? `${open.length} open, the next wakes at ${formatTime(nextWake)}`
									: open.length > 0
										? `${open.length} open`
										: "Nothing open"
							}
						/>
						<Stat
							label="Peak"
							value={String(peak)}
							hint={`At once, last ${rangeWord}`}
						/>
						<Stat
							label="Busy hours"
							value={String(busy)}
							hint={`Of the last ${rangeWord}`}
						/>
						<Stat
							label="Started"
							value={String(started)}
							hint={`Last ${rangeWord}`}
						/>
					</div>

					<ChartSection
						title="At work"
						hint="Runs at work in each hour, from start to end"
					>
						{peak === 0 ? (
							<DetailsEmpty>Nothing ran in the last {rangeWord}.</DetailsEmpty>
						) : (
							<ChartContainer
								config={CHART_CONFIG}
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
												formatter={(value) => (
													<div className="flex w-full items-center gap-2">
														<Swatch color="var(--color-active)" />
														<span className="text-muted-foreground">
															Runs at work
														</span>
														<span className="ml-auto font-medium font-mono tabular-nums">
															{Number(value)}
														</span>
													</div>
												)}
											/>
										}
									/>
									<Bar
										dataKey="active"
										fill="var(--color-active)"
										radius={[4, 4, 0, 0]}
									/>
								</BarChart>
							</ChartContainer>
						)}
					</ChartSection>
				</DetailsTabContent>

				<DetailsTabContent value="open">
					<ChartSection
						title="Open runs"
						hint={`The oldest ${Math.min(open.length, OVERVIEW_ROWS)}: at work, waiting for you or asleep`}
					>
						{open.length === 0 ? (
							<DetailsEmpty>No run is at work, waiting or asleep.</DetailsEmpty>
						) : (
							<>
								<ItemGroup className="gap-1">
									{open.slice(0, OVERVIEW_ROWS).map((run) => (
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
												<ItemDescription>
													{project ? null : `${groupOf(run)}, `}
													started {formatRelative(run.createdAt, now)}
													{run.wakeAt
														? `, wakes at ${formatTime(run.wakeAt)}`
														: null}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<RunStatusBadge status={run.status} />
												<span className="w-20 text-right text-muted-foreground tabular-nums">
													{formatDuration(Math.max(now - run.createdAt, 0))}
												</span>
											</ItemActions>
										</Item>
									))}
								</ItemGroup>
								<MoreRows
									hidden={open.length - OVERVIEW_ROWS}
									where="open runs"
								/>
							</>
						)}
					</ChartSection>
				</DetailsTabContent>

				<DetailsTabContent value="groups">
					<ChartSection
						title={
							project ? "Time at work per flow" : "Time at work per project"
						}
						hint={`The top ${Math.min(groups.length, OVERVIEW_ROWS)} of the last ${rangeWord}, the most time first`}
					>
						{groups.length === 0 ? (
							<DetailsEmpty>Nothing ran in the last {rangeWord}.</DetailsEmpty>
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
	/** Runs at work at some point since `since`. */
	runs: number;
	started: number;
	/** The time its runs were at work since `since`, added up. */
	atWork: number;
	longest: number;
};

/**
 * How long the runs of each flow or project were at work since `since`,
 * the most first. Only the part since `since` counts. An open run works
 * until now.
 */
function atWorkPerGroup(
	runs: RunSummary[],
	groupOf: (run: RunSummary) => string,
	since: number,
	now: number,
): GroupRow[] {
	const byLabel = new Map<string, GroupRow>();
	for (const run of runs) {
		const to = run.endedAt ?? (isOpen(run) ? now : run.createdAt);
		if (to < since) continue;
		const label = groupOf(run);
		const group = byLabel.get(label) ?? {
			label,
			runs: 0,
			started: 0,
			atWork: 0,
			longest: 0,
		};
		const atWork = Math.max(to - Math.max(run.createdAt, since), 0);
		group.runs += 1;
		if (run.createdAt >= since) group.started += 1;
		group.atWork += atWork;
		group.longest = Math.max(group.longest, atWork);
		byLabel.set(label, group);
	}
	return [...byLabel.values()].sort((a, b) => b.atWork - a.atWork);
}

const groupColumn = dataTableColumns<GroupRow>();

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
		groupColumn.accessor("started", {
			header: "Started",
			enableSorting: true,
			meta: count,
		}),
		groupColumn.accessor("longest", {
			header: "Longest",
			enableSorting: true,
			cell: ({ getValue }) => formatDuration(getValue()),
			meta: count,
		}),
		groupColumn.accessor("atWork", {
			header: "At work",
			enableSorting: true,
			cell: ({ getValue }) => formatDuration(getValue()),
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right font-medium tabular-nums",
			},
		}),
	]);
}
