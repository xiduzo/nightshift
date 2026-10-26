import { gateParts, waitedText } from "@nightshift/client";
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
import { formatDateTime, formatRelative, useNow } from "@/shared/format";
import { InlineMarkdown } from "@/shared/markdown";
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
import { OVERVIEW_ROWS } from "./overview";
import { nightsOf } from "./ranges";

type Tab = "overview" | "waiting" | "groups" | "latest";

/** How an asked Gate stands. In the order the chart stacks them. */
const STATE_CHART = {
	answered: { label: "Answered", color: "var(--status-finished)" },
	unanswered: { label: "Not answered", color: "var(--status-stopped)" },
	waiting: { label: "Waiting for you", color: "var(--status-waiting)" },
} satisfies ChartConfig;

type GatesRange = NightsRange["gates"];

/**
 * What waits for you, in detail, in tabs like Flow health: the open Gates,
 * how many Gates runs asked per night and how fast you answered, per flow
 * (or per project over all of them), and the latest. One range drives
 * every tab but the open Gates. Behind the "Waiting for you" card.
 */
export function GatesDialog({
	open,
	onOpenChange,
	gates,
	summary,
	project,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The open Gates, of `project` when given. */
	gates: OpenGate[];
	/** The numbers of `project` when given: the Gates its runs asked. */
	summary: DashboardSummary;
	project?: Project;
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<GatesDetails
				gates={gates}
				summary={summary}
				project={project}
				onNavigate={() => onOpenChange(false)}
			/>
		</DetailsDialog>
	);
}

function GatesDetails({
	gates,
	summary,
	project,
	onNavigate,
}: {
	gates: OpenGate[];
	summary: DashboardSummary;
	project?: Project;
	onNavigate: () => void;
}) {
	const now = useNow(60_000);
	const [range, setRange] = useState<NightRange>(30);
	const [tab, setTab] = useState<Tab>("overview");
	const waiting = gates.slice().sort((a, b) => a.openedAt - b.openedAt);
	const oldest = waiting[0];
	const asked = nightsOf(summary, range).gates;
	const { answerTime, runsAsking, groups } = asked;

	return (
		<>
			<DetailsHeader project={project} trail="Inbox" title="Gates" />

			<DetailsTabs
				tabs={[
					{ value: "overview", label: "Overview" },
					{ value: "waiting", label: "Waiting", count: waiting.length },
					{ value: "groups", label: project ? "By flow" : "By project" },
					{ value: "latest", label: "Latest" },
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
							label="Waiting now"
							value={String(waiting.length)}
							hint={
								oldest
									? `The oldest for ${waitedText(now - oldest.openedAt)}`
									: "Nothing needs you"
							}
						/>
						<Stat
							label="Asked"
							value={String(asked.asked)}
							hint={runsAsking === 1 ? "By 1 run" : `By ${runsAsking} runs`}
						/>
						<Stat
							label="Typical answer"
							value={answerTime ? waitedText(answerTime.median) : "—"}
							hint={
								answerTime && answerTime.count > 1
									? `Half within ${waitedText(answerTime.q1)} to ${waitedText(answerTime.q3)}`
									: `${asked.answered} answered`
							}
						/>
						<Stat
							label="Not answered"
							value={String(asked.unanswered)}
							hint="The run ended while it waited"
						/>
					</div>
					<AskedPerNight gates={asked} range={range} />
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

				<DetailsTabContent value="groups">
					<ChartSection
						title={project ? "Gates per flow" : "Gates per project"}
						hint={`The top ${groups.rows.length}, the most asked first`}
					>
						{groups.count === 0 ? (
							<DetailsEmpty>
								No run asked you anything in the last {range} nights.
							</DetailsEmpty>
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

				<DetailsTabContent value="latest">
					<ChartSection
						title="Latest Gates"
						hint={`The last ${asked.latest.length}, newest first`}
					>
						{asked.asked === 0 ? (
							<DetailsEmpty>
								No run asked you anything in the last {range} nights.
							</DetailsEmpty>
						) : (
							<ItemGroup className="gap-1">
								{asked.latest.map((gate) => (
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
											<ItemTitle className="w-full truncate">
												{gate.runTitle}
											</ItemTitle>
											<ItemDescription className="truncate">
												{project ? null : `${gate.group}, `}
												asked{" "}
												<time
													dateTime={new Date(gate.openedAt).toISOString()}
													title={formatDateTime(gate.openedAt)}
												>
													{formatRelative(gate.openedAt, now)}
												</time>
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
						)}
					</ChartSection>
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

/** Gates asked per night, stacked by how they stand. */
function AskedPerNight({
	gates,
	range,
}: {
	gates: GatesRange;
	range: NightRange;
}) {
	const { states } = gates;
	const rows = nightChartRows(gates.perNight);
	const config = Object.fromEntries(
		states.map((state) => [state, STATE_CHART[state]]),
	);
	return (
		<ChartSection
			title="History"
			hint="Gates asked per night, noon to noon, by how they stand"
		>
			{gates.asked === 0 ? (
				<DetailsEmpty>
					No run asked you anything in the last {range} nights.
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

type GroupRow = GatesRange["groups"]["rows"][number];

const groupColumn = dataTableColumns<GroupRow>();

function groupColumns(groupLabel: string) {
	const count = {
		headClassName: "text-right",
		cellClassName: "text-right tabular-nums",
	};
	const wait = (ms: number | null) => (ms === null ? "—" : waitedText(ms));
	return groupColumn.columns([
		groupColumn.accessor("label", {
			header: groupLabel,
			meta: { cellClassName: "max-w-48 truncate font-mono text-xs" },
		}),
		groupColumn.accessor("asked", {
			header: "Asked",
			enableSorting: true,
			meta: count,
		}),
		groupColumn.accessor("answered", {
			header: "Answered",
			enableSorting: true,
			meta: count,
		}),
		groupColumn.accessor("unanswered", {
			header: "Not answered",
			enableSorting: true,
			meta: count,
		}),
		// Null (none answered) sorts like a missing value: last.
		groupColumn.accessor((row) => row.typical ?? undefined, {
			id: "typical",
			header: "Typical answer",
			enableSorting: true,
			cell: ({ row }) => wait(row.original.typical),
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right font-medium tabular-nums",
			},
		}),
		groupColumn.accessor((row) => row.longest ?? undefined, {
			id: "longest",
			header: "Longest wait",
			enableSorting: true,
			cell: ({ row }) => wait(row.original.longest),
			meta: count,
		}),
	]);
}
