import {
	daysOf,
	gateParts,
	neededReasonLabel,
	neededReasonsText,
	neededShare,
	waitedText,
} from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
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
import type {
	DashboardSummary,
	GateState,
	NightRange,
	NightsRange,
	OpenGate,
	Project,
} from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { formatRelative, useNow } from "@/shared/format";
import { InlineMarkdown } from "@/shared/markdown";
import { LocalTime } from "@/shared/time";
import { dayChartRows } from "./days";
import {
	ChartSection,
	DayRangeToggle,
	DetailsDialog,
	DetailsEmpty,
	DetailsHeader,
	DetailsTabContent,
	DetailsTabs,
	MoreRows,
	Stat,
	Swatch,
} from "./details";
import { OVERVIEW_ROWS } from "./overview";

type Tab = "overview" | "waiting" | "runs" | "groups" | "gates";

/** The runs per day: those you stepped in on, and those that ran on their own. */
const DAY_CHART = {
	needed: { label: "Needed you", color: "var(--metric-needed)" },
	alone: { label: "On its own", color: "var(--status-finished)" },
} satisfies ChartConfig;

/** How an asked Gate stands. In the order the chart stacks them. */
const STATE_CHART = {
	answered: { label: "Answered", color: "var(--status-finished)" },
	unanswered: { label: "Not answered", color: "var(--status-stopped)" },
	waiting: { label: "Waiting for you", color: "var(--status-waiting)" },
} satisfies ChartConfig;

type GatesRange = NightsRange["gates"];
type NeededRange = NonNullable<NightsRange["needed"]>;

/** What an older Host says instead of why runs needed you: it does not count it. */
const NOT_COUNTED = "Update Night Shift to see how often runs need you.";

/**
 * How often runs needed you, in detail, in tabs like Flow health: the share
 * of runs a person stepped in on and why, the open Gates, the latest runs
 * that needed you, per flow (or per project over all of them), and the
 * Gates the runs asked. One range drives every tab but the open Gates.
 * Behind the "Needed you" number.
 */
export function NeededYouDialog({
	open,
	onOpenChange,
	gates,
	summary,
	project,
	initialRange,
	initialTab,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The open Gates, of `project` when given. */
	gates: OpenGate[];
	/** The numbers of `project` when given. */
	summary: DashboardSummary;
	project?: Project;
	/** The range it opens at: the page's. Default 30 days. */
	initialRange?: NightRange;
	/** The tab it opens at. Default Overview. */
	initialTab?: Tab;
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<NeededYouDetails
				gates={gates}
				summary={summary}
				project={project}
				onNavigate={() => onOpenChange(false)}
				initialRange={initialRange}
				initialTab={initialTab}
			/>
		</DetailsDialog>
	);
}

function NeededYouDetails({
	gates: waiting,
	summary,
	project,
	onNavigate,
	initialRange = 30,
	initialTab = "overview",
}: {
	/** Oldest first: the Host sends them in the inbox order. */
	gates: OpenGate[];
	summary: DashboardSummary;
	project?: Project;
	onNavigate: () => void;
	initialRange?: NightRange;
	initialTab?: Tab;
}) {
	const now = useNow(60_000);
	const [range, setRange] = useState<NightRange>(initialRange);
	const [tab, setTab] = useState<Tab>(initialTab);
	const oldest = waiting[0];
	const days = daysOf(summary, range);
	const asked = days.gates;
	const needed = days.needed;
	const share = neededShare(days.totals);
	const groupLabel = project ? "Flow" : "Project";

	return (
		<>
			<DetailsHeader project={project} trail="Runs" title="Needed you" />

			<DetailsTabs
				tabs={[
					{ value: "overview", label: "Overview" },
					{ value: "waiting", label: "Waiting", count: waiting.length },
					{ value: "runs", label: "Runs" },
					{ value: "groups", label: project ? "By flow" : "By project" },
					{ value: "gates", label: "Gates" },
				]}
				value={tab}
				onValueChange={setTab}
				toggle={
					<DayRangeToggle
						ranges={summary.nights.map((n) => n.nights)}
						value={range}
						onValueChange={setRange}
					/>
				}
			>
				<DetailsTabContent value="overview">
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
						<Stat
							label="Needed you"
							value={share === null ? "—" : `${share}%`}
							hint={
								needed ? `${needed.needed} of ${needed.runs} runs` : "Not known"
							}
						/>
						<Stat
							label="On their own"
							value={needed ? String(needed.runs - needed.needed) : "—"}
							hint="Runs that needed nobody"
						/>
						<Stat
							label="Waiting now"
							value={String(waiting.length)}
							hint={
								oldest
									? `The oldest for ${waitedText(now - oldest.openedAt)}`
									: "Nothing needs you"
							}
						/>
					</div>
					<Reasons needed={needed} range={range} />
					<NeededPerDay needed={needed} range={range} />
				</DetailsTabContent>

				<DetailsTabContent value="waiting">
					<ChartSection
						title="Waiting for you"
						hint={`The oldest ${Math.min(waiting.length, OVERVIEW_ROWS)}. Open one to answer it.`}
					>
						{waiting.length === 0 ? (
							<DetailsEmpty>No Gate waits for your answer.</DetailsEmpty>
						) : (
							<>
								<ItemGroup className="gap-1">
									{waiting.slice(0, OVERVIEW_ROWS).map((gate) => (
										<Item
											key={gate.stepId}
											size="xs"
											render={
												<Link
													to="/runs/$runId"
													params={{ runId: gate.runId }}
													onClick={onNavigate}
												/>
											}
										>
											<ItemContent className="min-w-0">
												<ItemTitle className="w-full truncate">
													<InlineMarkdown
														text={gateParts(gate.question).headline}
														links={false}
													/>
												</ItemTitle>
												<ItemDescription className="truncate">
													{project ? null : `${gate.projectName}, `}
													{gate.runTitle}
												</ItemDescription>
											</ItemContent>
											<ItemActions className="text-muted-foreground tabular-nums">
												{waitedText(now - gate.openedAt)}
											</ItemActions>
										</Item>
									))}
								</ItemGroup>
								<MoreRows
									hidden={waiting.length - OVERVIEW_ROWS}
									where="in the inbox"
								/>
							</>
						)}
					</ChartSection>
				</DetailsTabContent>

				<DetailsTabContent value="runs">
					<ChartSection
						title="Runs that needed you"
						hint={`The last ${needed?.latest.length ?? 0}, newest first`}
					>
						{!needed ? (
							<DetailsEmpty>{NOT_COUNTED}</DetailsEmpty>
						) : needed.needed === 0 ? (
							<DetailsEmpty>
								No run needed you in the last {range} days.
							</DetailsEmpty>
						) : (
							<ItemGroup className="gap-1">
								{needed.latest.map((run) => (
									<Item
										key={run.runId}
										size="xs"
										render={
											<Link
												to="/runs/$runId"
												params={{ runId: run.runId }}
												onClick={onNavigate}
											/>
										}
									>
										<ItemContent className="min-w-0">
											<ItemTitle className="w-full truncate">
												{run.runTitle}
											</ItemTitle>
											<ItemDescription className="truncate">
												{project ? null : `${run.group}, `}
												started{" "}
												<LocalTime at={run.createdAt}>
													{formatRelative(run.createdAt, now)}
												</LocalTime>
											</ItemDescription>
										</ItemContent>
										<ItemActions className="flex-wrap justify-end">
											{run.reasons.map((reason) => (
												<Badge key={reason} variant="outline">
													{neededReasonLabel(reason)}
												</Badge>
											))}
										</ItemActions>
									</Item>
								))}
							</ItemGroup>
						)}
					</ChartSection>
				</DetailsTabContent>

				<DetailsTabContent value="groups">
					<ChartSection
						title={project ? "Needed you per flow" : "Needed you per project"}
						hint={`The top ${needed?.groups.rows.length ?? 0}, the most runs that needed you first`}
					>
						{!needed ? (
							<DetailsEmpty>{NOT_COUNTED}</DetailsEmpty>
						) : needed.groups.count === 0 ? (
							<DetailsEmpty>
								No run needed you in the last {range} days.
							</DetailsEmpty>
						) : (
							<>
								<DataTable
									columns={neededGroupColumns(groupLabel)}
									data={needed.groups.rows}
									getRowId={(group) => group.label}
								/>
								<MoreRows
									hidden={needed.groups.count - needed.groups.rows.length}
									where={project ? "flows" : "projects"}
								/>
							</>
						)}
					</ChartSection>
				</DetailsTabContent>

				<DetailsTabContent value="gates">
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
						<Stat
							label="Asked"
							value={String(asked.asked)}
							hint={
								asked.runsAsking === 1
									? "By 1 run"
									: `By ${asked.runsAsking} runs`
							}
						/>
						<Stat
							label="Typical answer"
							value={
								asked.answerTime ? waitedText(asked.answerTime.median) : "—"
							}
							hint={
								asked.answerTime && asked.answerTime.count > 1
									? `Half within ${waitedText(asked.answerTime.q1)} to ${waitedText(asked.answerTime.q3)}`
									: `${asked.answered} answered`
							}
						/>
						<Stat
							label="Not answered"
							value={String(asked.unanswered)}
							hint="The run ended while it waited"
						/>
					</div>
					<AskedPerDay gates={asked} range={range} />
					<ChartSection
						title={project ? "Gates per flow" : "Gates per project"}
						hint={`The top ${asked.groups.rows.length}, the most asked first`}
					>
						{asked.groups.count === 0 ? (
							<DetailsEmpty>
								No run asked you anything in the last {range} days.
							</DetailsEmpty>
						) : (
							<>
								<DataTable
									columns={gateGroupColumns(groupLabel)}
									data={asked.groups.rows}
									getRowId={(group) => group.label}
								/>
								<MoreRows
									hidden={asked.groups.count - asked.groups.rows.length}
									where={project ? "flows" : "projects"}
								/>
							</>
						)}
					</ChartSection>
					<LatestGates
						gates={asked}
						project={project}
						now={now}
						onNavigate={onNavigate}
					/>
				</DetailsTabContent>
			</DetailsTabs>

			<DialogFooter>
				<Button
					variant="outline"
					nativeButton={false}
					render={<Link to="/inbox" onClick={onNavigate} />}
				>
					Inbox
					<ArrowRightIcon data-icon="inline-end" />
				</Button>
			</DialogFooter>
		</>
	);
}

/** Why runs needed you: what you did, and in how many runs, the most first. */
function Reasons({
	needed,
	range,
}: {
	needed: NeededRange | undefined;
	range: NightRange;
}) {
	return (
		<ChartSection title="Why" hint="What you did, and in how many runs">
			{!needed ? (
				<DetailsEmpty>{NOT_COUNTED}</DetailsEmpty>
			) : needed.reasons.length === 0 ? (
				<DetailsEmpty>No run needed you in the last {range} days.</DetailsEmpty>
			) : (
				<ItemGroup className="gap-1">
					{needed.reasons.map(({ reason, runs }) => (
						<Item key={reason} size="xs" variant="outline">
							<ItemContent>
								<ItemTitle>{neededReasonLabel(reason)}</ItemTitle>
							</ItemContent>
							<ItemActions className="text-muted-foreground tabular-nums">
								{runs === 1 ? "1 run" : `${runs} runs`}
							</ItemActions>
						</Item>
					))}
				</ItemGroup>
			)}
		</ChartSection>
	);
}

/** Runs per day, stacked: the ones that needed you, and the ones that ran on their own. */
function NeededPerDay({
	needed,
	range,
}: {
	needed: NeededRange | undefined;
	range: NightRange;
}) {
	if (!needed) return null;
	const rows = dayChartRows(needed.perNight);
	const keys = ["needed", "alone"] as const;
	return (
		<ChartSection
			title="History"
			hint="Runs per day: the ones that needed you, and the ones that ran on their own"
		>
			{needed.runs === 0 ? (
				<DetailsEmpty>No run started in the last {range} days.</DetailsEmpty>
			) : (
				<ChartContainer config={DAY_CHART} className="aspect-auto h-48 w-full">
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
								/>
							}
						/>
						{keys.map((key, index) => (
							<Bar
								key={key}
								dataKey={key}
								stackId="needed"
								fill={`var(--color-${key})`}
								radius={index === keys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
							/>
						))}
					</BarChart>
				</ChartContainer>
			)}
		</ChartSection>
	);
}

/** The newest Gates the runs asked, with how each stands and how long it waited. */
function LatestGates({
	gates,
	project,
	now,
	onNavigate,
}: {
	gates: GatesRange;
	project?: Project;
	now: number;
	onNavigate: () => void;
}) {
	if (gates.asked === 0) return null;
	return (
		<ChartSection
			title="Latest Gates"
			hint={`The last ${gates.latest.length}, newest first`}
		>
			<ItemGroup className="gap-1">
				{gates.latest.map((gate) => (
					<Item
						key={gate.key}
						size="xs"
						render={
							<Link
								to="/runs/$runId"
								params={{ runId: gate.runId }}
								onClick={onNavigate}
							/>
						}
					>
						<ItemContent className="min-w-0">
							<ItemTitle className="w-full truncate">{gate.runTitle}</ItemTitle>
							<ItemDescription className="truncate">
								{project ? null : `${gate.group}, `}
								asked{" "}
								<LocalTime at={gate.openedAt}>
									{formatRelative(gate.openedAt, now)}
								</LocalTime>
							</ItemDescription>
						</ItemContent>
						<ItemActions>
							<Badge variant="outline">
								<Swatch color={STATE_CHART[gate.state].color} />
								{STATE_CHART[gate.state].label}
							</Badge>
							<span className="w-28 text-right text-muted-foreground tabular-nums">
								{gate.wait === null ? "—" : waitedText(gate.wait)}
							</span>
						</ItemActions>
					</Item>
				))}
			</ItemGroup>
		</ChartSection>
	);
}

/** Gates asked per day, stacked by how they stand. */
function AskedPerDay({
	gates,
	range,
}: {
	gates: GatesRange;
	range: NightRange;
}) {
	const { states } = gates;
	const rows = dayChartRows(gates.perNight);
	const config = Object.fromEntries(
		states.map((state) => [state, STATE_CHART[state]]),
	);
	return (
		<ChartSection title="Gates per day" hint="Gates asked per day, by status">
			{gates.asked === 0 ? (
				<DetailsEmpty>
					No run asked you anything in the last {range} days.
				</DetailsEmpty>
			) : (
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
												{STATE_CHART[name as GateState]?.label ?? name}
											</span>
											<span className="ml-auto font-medium font-mono tabular-nums">
												{Number(value)}
											</span>
										</div>
									)}
								/>
							}
						/>
						{states.map((state, index) => (
							<Bar
								key={state}
								dataKey={state}
								stackId="gates"
								fill={`var(--color-${state})`}
								radius={
									index === states.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]
								}
							/>
						))}
					</BarChart>
				</ChartContainer>
			)}
		</ChartSection>
	);
}

type NeededGroupRow = NeededRange["groups"]["rows"][number];

const neededColumn = dataTableColumns<NeededGroupRow>();

function neededGroupColumns(groupLabel: string) {
	const count = {
		headClassName: "text-right",
		cellClassName: "text-right tabular-nums",
	};
	return neededColumn.columns([
		neededColumn.accessor("label", {
			header: groupLabel,
			meta: { cellClassName: "max-w-48 truncate font-mono text-xs" },
		}),
		neededColumn.accessor("runs", {
			header: "Runs",
			enableSorting: true,
			meta: count,
		}),
		neededColumn.accessor("needed", {
			header: "Needed you",
			enableSorting: true,
			meta: count,
		}),
		neededColumn.accessor(
			(row) => neededShare({ runs: row.runs, neededYou: row.needed }) ?? 0,
			{
				id: "share",
				header: "Share",
				enableSorting: true,
				cell: ({ getValue }) => `${getValue()}%`,
				meta: {
					headClassName: "text-right",
					cellClassName: "text-right font-medium tabular-nums",
				},
			},
		),
		neededColumn.accessor((row) => neededReasonsText(row.reasons), {
			id: "why",
			header: "Why",
			meta: { cellClassName: "max-w-64 truncate text-muted-foreground" },
		}),
	]);
}

type GateGroupRow = GatesRange["groups"]["rows"][number];

const gateColumn = dataTableColumns<GateGroupRow>();

function gateGroupColumns(groupLabel: string) {
	const count = {
		headClassName: "text-right",
		cellClassName: "text-right tabular-nums",
	};
	const wait = (ms: number | null) => (ms === null ? "—" : waitedText(ms));
	return gateColumn.columns([
		gateColumn.accessor("label", {
			header: groupLabel,
			meta: { cellClassName: "max-w-48 truncate font-mono text-xs" },
		}),
		gateColumn.accessor("asked", {
			header: "Asked",
			enableSorting: true,
			meta: count,
		}),
		gateColumn.accessor("answered", {
			header: "Answered",
			enableSorting: true,
			meta: count,
		}),
		gateColumn.accessor("unanswered", {
			header: "Not answered",
			enableSorting: true,
			meta: count,
		}),
		// Null (none answered) sorts like a missing value: last.
		gateColumn.accessor((row) => row.typical ?? undefined, {
			id: "typical",
			header: "Typical answer",
			enableSorting: true,
			cell: ({ row }) => wait(row.original.typical),
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right font-medium tabular-nums",
			},
		}),
		gateColumn.accessor((row) => row.longest ?? undefined, {
			id: "longest",
			header: "Longest wait",
			enableSorting: true,
			cell: ({ row }) => wait(row.original.longest),
			meta: count,
		}),
	]);
}
