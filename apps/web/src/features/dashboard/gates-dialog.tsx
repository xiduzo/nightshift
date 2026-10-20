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
import type { OpenGate, Project, RunSummary } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	formatDateTime,
	formatRelative,
	formatWaited,
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
import { spreadOf } from "./flow-runs";
import {
	formatNight,
	formatNightShort,
	inLastNights,
	lastNights,
	nightOf,
} from "./nights";
import { OVERVIEW_ROWS } from "./overview";
import { spendGroupOf } from "./spend";

type Tab = "overview" | "waiting" | "groups" | "latest";

/** How an asked Gate stands. In the order the chart stacks them. */
type GateState = "answered" | "unanswered" | "waiting";
const STATE_CHART = {
	answered: { label: "Answered", color: "var(--status-finished)" },
	unanswered: { label: "Not answered", color: "var(--status-stopped)" },
	waiting: { label: "Waiting for you", color: "var(--status-waiting)" },
} satisfies ChartConfig;
const STATES = Object.keys(STATE_CHART) as GateState[];

/** One Gate a run asked. */
type AskedGate = {
	key: string;
	runId: string;
	runTitle: string;
	/** Its flow, or its project over all projects. */
	group: string;
	openedAt: number;
	state: GateState;
	/** How long it waited, until now while it waits. Null when not known. */
	wait: number | null;
};

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
	runs,
	project,
	projects,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The open Gates, of `project` when given. */
	gates: OpenGate[];
	/** The runs, of `project` when given: each knows when its Gates opened and closed. */
	runs: RunSummary[];
	project?: Project;
	/** To name the project of each run, over all projects. */
	projects?: Project[];
}) {
	return (
		<DetailsDialog open={open} onOpenChange={onOpenChange}>
			<GatesDetails
				gates={gates}
				runs={runs}
				project={project}
				projects={projects}
				onNavigate={() => onOpenChange(false)}
			/>
		</DetailsDialog>
	);
}

function GatesDetails({
	gates,
	runs,
	project,
	projects,
	onNavigate,
}: {
	gates: OpenGate[];
	runs: RunSummary[];
	project?: Project;
	projects?: Project[];
	onNavigate: () => void;
}) {
	const now = useNow(60_000);
	const [range, setRange] = useState<NightRange>(30);
	const [tab, setTab] = useState<Tab>("overview");
	const groupOf = spendGroupOf(project, projects);
	const waiting = gates.slice().sort((a, b) => a.openedAt - b.openedAt);
	const oldest = waiting[0];
	const asked = askedGates(runs, groupOf, now)
		.filter((gate) => inLastNights(gate.openedAt, range, now))
		.sort((a, b) => a.openedAt - b.openedAt);
	const answered = asked.filter((gate) => gate.state === "answered");
	const unanswered = asked.filter((gate) => gate.state === "unanswered");
	const answerTime = spreadOf(waitsOf(answered));
	const runsAsking = new Set(asked.map((gate) => gate.runId)).size;
	const groups = perGroup(asked);

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
				toggle={<NightRangeToggle value={range} onValueChange={setRange} />}
			>
				<DetailsTabContent value="overview">
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
						<Stat
							label="Waiting now"
							value={String(waiting.length)}
							hint={
								oldest
									? `The oldest for ${formatWaited(now - oldest.openedAt)}`
									: "Nothing needs you"
							}
						/>
						<Stat
							label="Asked"
							value={String(asked.length)}
							hint={runsAsking === 1 ? "By 1 run" : `By ${runsAsking} runs`}
						/>
						<Stat
							label="Typical answer"
							value={answerTime ? formatWaited(answerTime.median) : "—"}
							hint={
								answerTime && answerTime.count > 1
									? `Half within ${formatWaited(answerTime.q1)} to ${formatWaited(answerTime.q3)}`
									: `${answered.length} answered`
							}
						/>
						<Stat
							label="Not answered"
							value={String(unanswered.length)}
							hint="The run ended while it waited"
						/>
					</div>
					<AskedPerNight gates={asked} range={range} now={now} />
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
													{gate.question}
												</ItemTitle>
												<ItemDescription className="truncate">
													{project ? null : `${gate.projectName}, `}
													{gate.runTitle}
												</ItemDescription>
											</ItemContent>
											<ItemActions className="text-muted-foreground tabular-nums">
												{formatWaited(now - gate.openedAt)}
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
						hint={`The top ${Math.min(groups.length, OVERVIEW_ROWS)}, the most asked first`}
					>
						{groups.length === 0 ? (
							<DetailsEmpty>
								No run asked you anything in the last {range} nights.
							</DetailsEmpty>
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

				<DetailsTabContent value="latest">
					<ChartSection
						title="Latest Gates"
						hint={`The last ${Math.min(asked.length, OVERVIEW_ROWS)}, newest first`}
					>
						{asked.length === 0 ? (
							<DetailsEmpty>
								No run asked you anything in the last {range} nights.
							</DetailsEmpty>
						) : (
							<ItemGroup className="gap-1">
								{asked
									.slice(-OVERVIEW_ROWS)
									.reverse()
									.map((gate) => (
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
													{gate.wait === null ? "—" : formatWaited(gate.wait)}
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

/**
 * Every Gate the runs asked. A Gate that closed when its run ended, without
 * the run finishing, was not answered: the run stopped or failed while it
 * waited. So was one left open by a run that no longer waits.
 */
function askedGates(
	runs: RunSummary[],
	groupOf: (run: RunSummary) => string,
	now: number,
): AskedGate[] {
	return runs.flatMap((run) =>
		run.gates.map((gate, index) => {
			const state: GateState =
				gate.closedAt === null
					? run.status === "waiting"
						? "waiting"
						: "unanswered"
					: gate.closedAt === run.endedAt && run.status !== "finished"
						? "unanswered"
						: "answered";
			return {
				key: `${run.id}-${index}`,
				runId: run.id,
				runTitle: run.title,
				group: groupOf(run),
				openedAt: gate.openedAt,
				state,
				wait:
					gate.closedAt !== null
						? gate.closedAt - gate.openedAt
						: state === "waiting"
							? Math.max(now - gate.openedAt, 0)
							: null,
			};
		}),
	);
}

function waitsOf(gates: AskedGate[]): number[] {
	return gates.flatMap((gate) => (gate.wait === null ? [] : [gate.wait]));
}

/** Gates asked per night, stacked by how they stand. */
function AskedPerNight({
	gates,
	range,
	now,
}: {
	gates: AskedGate[];
	range: NightRange;
	now: number;
}) {
	const states = STATES.filter((state) =>
		gates.some((gate) => gate.state === state),
	);
	const rows = lastNights(range, now).map((night) => {
		const row: Record<string, number | string> = {
			label: formatNightShort(night),
			title: formatNight(night),
		};
		for (const state of states) row[state] = 0;
		for (const gate of gates) {
			if (nightOf(gate.openedAt) === night) {
				row[gate.state] = (row[gate.state] as number) + 1;
			}
		}
		return row;
	});
	const config = Object.fromEntries(
		states.map((state) => [state, STATE_CHART[state]]),
	);
	return (
		<ChartSection
			title="History"
			hint="Gates asked per night, noon to noon, by how they stand"
		>
			{gates.length === 0 ? (
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

type GroupRow = {
	label: string;
	asked: number;
	answered: number;
	unanswered: number;
	/** The median wait of the answered Gates. */
	typical: number | undefined;
	/** The longest wait, the open Gates too. */
	longest: number | undefined;
};

function perGroup(gates: AskedGate[]): GroupRow[] {
	const byLabel = new Map<string, AskedGate[]>();
	for (const gate of gates) {
		byLabel.set(gate.group, [...(byLabel.get(gate.group) ?? []), gate]);
	}
	return [...byLabel.entries()]
		.map(([label, ofGroup]) => {
			const answered = ofGroup.filter((gate) => gate.state === "answered");
			return {
				label,
				asked: ofGroup.length,
				answered: answered.length,
				unanswered: ofGroup.filter((gate) => gate.state === "unanswered")
					.length,
				typical: spreadOf(waitsOf(answered))?.median,
				longest: spreadOf(waitsOf(ofGroup))?.max,
			};
		})
		.sort((a, b) => b.asked - a.asked);
}

const groupColumn = dataTableColumns<GroupRow>();

function groupColumns(groupLabel: string) {
	const count = {
		headClassName: "text-right",
		cellClassName: "text-right tabular-nums",
	};
	const wait = ({ getValue }: { getValue: () => number | undefined }) => {
		const ms = getValue();
		return ms === undefined ? "—" : formatWaited(ms);
	};
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
		groupColumn.accessor("typical", {
			header: "Typical answer",
			enableSorting: true,
			cell: wait,
			meta: {
				headClassName: "text-right",
				cellClassName: "text-right font-medium tabular-nums",
			},
		}),
		groupColumn.accessor("longest", {
			header: "Longest wait",
			enableSorting: true,
			cell: wait,
			meta: count,
		}),
	]);
}
