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
import type {
	ActivityRange,
	DashboardSummary,
	HourRange,
	Project,
} from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	formatDayTime,
	formatDuration,
	formatRelative,
	formatTime,
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
	RangeToggle,
	Stat,
	Swatch,
} from "./details";
import { hoursOf } from "./ranges";

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
	summary,
	project,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	summary: DashboardSummary;
	/** One project; otherwise all of them. */
	project?: Project;
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<ActivityDetails
				summary={summary}
				project={project}
				onNavigate={() => onOpenChange(false)}
			/>
		</DetailsDialog>
	);
}

function ActivityDetails({
	summary,
	project,
	onNavigate,
}: {
	summary: DashboardSummary;
	project?: Project;
	onNavigate: () => void;
}) {
	const now = useNow(60_000);
	const [range, setRange] = useState<HourRange>(24);
	const [tab, setTab] = useState<Tab>("overview");
	const { perHour, peak, busy, started, groups } = hoursOf(summary, range);
	const open = summary.open;
	const { running, nextWakeAt: nextWake } = open;
	const rows = perHour.map(({ hour, active }) => ({
		active,
		label:
			range > 48
				? new Date(hour).toLocaleDateString(undefined, { weekday: "short" })
				: formatTime(hour),
		title: formatDayTime(hour),
	}));
	const rangeWord = range > 48 ? "7 days" : `${range} h`;

	return (
		<>
			<DetailsHeader project={project} trail="Runs" title="Activity" />

			<DetailsTabs
				tabs={[
					{ value: "overview", label: "Overview" },
					{ value: "open", label: "Open runs", count: open.count },
					{ value: "groups", label: project ? "By flow" : "By project" },
				]}
				value={tab}
				onValueChange={setTab}
				toggle={
					<RangeToggle
						ranges={summary.activity.map((a) => a.hours)}
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
									? `${open.count} open, the next wakes at ${formatTime(nextWake)}`
									: open.count > 0
										? `${open.count} open`
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
						hint={`The oldest ${open.rows.length}: at work, waiting for you or asleep`}
					>
						{open.count === 0 ? (
							<DetailsEmpty>No run is at work, waiting or asleep.</DetailsEmpty>
						) : (
							<>
								<ItemGroup className="gap-1">
									{open.rows.map((run) => (
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
													{project ? null : `${run.group}, `}
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
									hidden={open.count - open.rows.length}
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
						hint={`The top ${groups.rows.length} of the last ${rangeWord}, the most time first`}
					>
						{groups.count === 0 ? (
							<DetailsEmpty>Nothing ran in the last {rangeWord}.</DetailsEmpty>
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

type GroupRow = ActivityRange["groups"]["rows"][number];

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
