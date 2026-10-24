import { Badge } from "@nightshift/ui/components/badge";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	type ChartConfig,
	ChartContainer,
} from "@nightshift/ui/components/chart";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
	ArrowRightIcon,
	CircleXIcon,
	HourglassIcon,
	LoaderCircleIcon,
	MinusIcon,
	MoonIcon,
	TrendingDownIcon,
	TrendingUpIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Bar, BarChart, YAxis } from "recharts";
import { useOpenGates } from "@/features/gates";
import type { DashboardSummary, Project } from "@/shared/api";
import {
	formatCost,
	formatDateTime,
	formatKnownCost,
	formatTime,
} from "@/shared/format";
import { ActivityDialog } from "./activity-dialog";
import { GatesDialog } from "./gates-dialog";
import { RunsDialog } from "./runs-dialog";
import { SpendDialog } from "./spend-dialog";

/** Which card's details are open. */
type Details = "activity" | "gates" | "spend" | "runs";
const SPEND_CONFIG = {
	cost: { label: "Spend", color: "var(--chart-2)" },
} satisfies ChartConfig;
const ACTIVE_CONFIG = {
	active: { label: "Active runs", color: "var(--status-running)" },
} satisfies ChartConfig;
const GATES_CONFIG = {
	gates: { label: "Gates", color: "var(--status-waiting)" },
} satisfies ChartConfig;
/** Bottom to top: failures sit on top, where they show. */
const OUTCOMES_CONFIG = {
	finished: { label: "Finished", color: "var(--status-finished)" },
	other: {
		label: "Stopped, running or waiting",
		color: "var(--status-stopped)",
	},
	failed: { label: "Failed", color: "var(--status-failed)" },
} satisfies ChartConfig;

/**
 * The numbers on top, as in the shadcn `dashboard-01` block, from the
 * dashboard's numbers and the open Gates. Over all projects, or over one
 * when `project` is given. Each card opens its details.
 */
export function SectionCards({
	summary,
	isLoading,
	project,
}: {
	/** Undefined while it loads. */
	summary: DashboardSummary | undefined;
	isLoading: boolean;
	project?: Project;
}) {
	const projectId = project?.id;
	// Every Space, like the inbox and its badge; the other numbers are this Space's.
	const gates = useOpenGates();
	const [details, setDetails] = useState<Details | null>(null);
	const detailsProps = (of: Details) => ({
		open: details === of,
		onOpenChange: (open: boolean) => setDetails(open ? of : null),
	});
	const cards = summary?.cards;
	const loading = isLoading;
	const running = cards?.running ?? 0;
	const sleeping = cards?.sleeping ?? 0;
	// The one that wakes first.
	const nextWake = cards?.nextWakeAt ?? null;
	const lastDay = cards?.lastDay;
	const lastDayRuns = lastDay?.runs ?? 0;
	const finished = lastDay?.finished ?? 0;
	const failed = lastDay?.failed ?? 0;
	const hours = cards?.hours ?? [];
	const dayBefore = cards?.dayBefore;
	const yesterday = cards?.yesterday;
	const openGates =
		gates.data?.filter(
			(gate) => projectId === undefined || gate.projectId === projectId,
		) ?? [];
	const waiting = openGates.length;

	return (
		<>
			<div className="grid grid-cols-2 gap-3 *:data-[slot=card]:bg-linear-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card md:grid-cols-2 md:gap-4 xl:grid-cols-4 dark:*:data-[slot=card]:bg-card">
				<StatCard
					label="Running now"
					onOpen={() => setDetails("activity")}
					value={loading ? null : running}
					trend={
						yesterday ? (
							<Trend
								now={running}
								before={yesterday.running}
								than="this time yesterday"
							/>
						) : null
					}
					chart={loading ? null : <ActiveSparkline hours={hours} />}
					badge={
						sleeping > 0 ? (
							<Badge
								variant="outline"
								className="border-status-sleeping/40 bg-status-sleeping/10 text-status-sleeping"
							>
								<MoonIcon aria-hidden="true" />
								{sleeping} sleeping
							</Badge>
						) : running > 0 ? (
							<Badge
								variant="outline"
								className="border-status-running/40 bg-status-running/10 text-status-running"
							>
								<LoaderCircleIcon
									aria-hidden="true"
									className="animate-spin motion-reduce:animate-none"
								/>
								Live
							</Badge>
						) : null
					}
					headline={
						running > 0
							? `${running === 1 ? "An agent is" : "Agents are"} at work`
							: "Nothing running"
					}
					footer={
						nextWake ? (
							<>
								Next wakes at{" "}
								<time
									dateTime={new Date(nextWake).toISOString()}
									title={formatDateTime(nextWake)}
								>
									{formatTime(nextWake)}
								</time>
							</>
						) : projectId ? (
							"Start a flow or a quick run"
						) : (
							"Start a flow from its project"
						)
					}
				/>
				<StatCard
					label="Waiting for you"
					onOpen={() => setDetails("gates")}
					value={gates.isLoading ? null : gates.error ? "—" : waiting}
					trend={
						yesterday && gates.data ? (
							<Trend
								now={waiting}
								before={yesterday.gates}
								than="this time yesterday"
							/>
						) : null
					}
					chart={loading ? null : <GatesSparkline hours={hours} />}
					className={
						waiting > 0
							? "ring-status-waiting/50 dark:ring-status-waiting/40"
							: undefined
					}
					badge={
						<Badge
							variant="outline"
							// Above the button that covers the card.
							className={cn(
								"relative z-10",
								waiting > 0 &&
									"border-status-waiting/40 bg-status-waiting/10 text-status-waiting",
							)}
							render={<Link to="/inbox" />}
						>
							Inbox
							<ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
						</Badge>
					}
					headline={
						waiting > 0 ? (
							<span className="flex items-center gap-1.5 text-status-waiting">
								<HourglassIcon className="size-4" aria-hidden="true" />
								{waiting === 1 ? "A Gate needs" : "Gates need"} your answer
							</span>
						) : (
							"Nothing needs you"
						)
					}
					footer={
						projectId
							? "Runs pause at a Gate for you"
							: "Gates of every Space you are in"
					}
				/>
				<StatCard
					label="Spent, last 24 h"
					onOpen={() => setDetails("spend")}
					value={
						loading ? null : formatKnownCost(lastDay?.cost ?? { costUsd: 0 })
					}
					trend={
						dayBefore ? (
							<Trend
								now={lastDay?.cost.costUsd ?? 0}
								before={dayBefore.cost.costUsd}
								than="the 24 hours before"
								format={formatCost}
								fewer="less"
							/>
						) : null
					}
					chart={loading ? null : <SpendSparkline hours={hours} />}
					badge={
						<Badge variant="outline" className="tabular-nums">
							{lastDayRuns} {lastDayRuns === 1 ? "run" : "runs"}
						</Badge>
					}
					headline={projectId ? "In this project" : "Over all projects"}
					footer={
						<>
							All time{" "}
							<span className="tabular-nums">
								{cards ? formatKnownCost(cards.allTime) : "—"}
							</span>
						</>
					}
				/>
				<StatCard
					label="Runs, last 24 h"
					onOpen={() => setDetails("runs")}
					value={loading ? null : lastDayRuns}
					trend={
						dayBefore ? (
							<Trend
								now={lastDayRuns}
								before={dayBefore.runs}
								than="the 24 hours before"
							/>
						) : null
					}
					chart={loading ? null : <OutcomesSparkline hours={hours} />}
					badge={
						failed > 0 ? (
							<Badge variant="destructive" className="tabular-nums">
								<CircleXIcon aria-hidden="true" />
								{failed} failed
							</Badge>
						) : lastDayRuns > 0 ? (
							<Badge
								variant="outline"
								className="border-status-finished/40 bg-status-finished/10 text-status-finished"
							>
								None failed
							</Badge>
						) : null
					}
					headline={
						<span className="tabular-nums">
							{finished} finished, {failed} failed
						</span>
					}
					footer={
						lastDayRuns - finished - failed > 0
							? `${lastDayRuns - finished - failed} stopped, running or waiting`
							: "Started in the last day"
					}
				/>
			</div>
			{summary ? (
				<>
					<ActivityDialog
						{...detailsProps("activity")}
						summary={summary}
						project={project}
					/>
					<GatesDialog
						{...detailsProps("gates")}
						gates={openGates}
						summary={summary}
						project={project}
					/>
					<SpendDialog
						{...detailsProps("spend")}
						summary={summary}
						project={project}
					/>
					<RunsDialog
						{...detailsProps("runs")}
						summary={summary}
						project={project}
					/>
				</>
			) : null}
		</>
	);
}

type CardHours = DashboardSummary["cards"]["hours"];

/** Spend per hour over the last 24 hours, by when the run started. */
function SpendSparkline({ hours }: { hours: CardHours }) {
	return (
		<Sparkline
			data={hours.map(({ costUsd }) => ({ cost: costUsd }))}
			config={SPEND_CONFIG}
		/>
	);
}

/** How many runs were at work in each of the last 24 hours. */
function ActiveSparkline({ hours }: { hours: CardHours }) {
	return (
		<Sparkline
			data={hours.map(({ active }) => ({ active }))}
			config={ACTIVE_CONFIG}
		/>
	);
}

/** How many Gates waited for you in each of the last 24 hours. */
function GatesSparkline({ hours }: { hours: CardHours }) {
	return (
		<Sparkline
			data={hours.map(({ gates }) => ({ gates }))}
			config={GATES_CONFIG}
		/>
	);
}

/**
 * Runs per hour over the last 24 hours, by how they ended. The bars add up
 * to the card's number.
 */
function OutcomesSparkline({ hours }: { hours: CardHours }) {
	return (
		<Sparkline
			data={hours.map(({ finished, failed, other }) => ({
				finished,
				failed,
				other,
			}))}
			config={OUTCOMES_CONFIG}
		/>
	);
}

/**
 * Bars without axes, one stack per data point with a series per `config`
 * key. Every bar is at least a pixel, so an empty point still reads as a
 * slot on the timeline.
 */
function Sparkline({
	data,
	config,
}: {
	data: Record<string, number>[];
	config: ChartConfig;
}) {
	const keys = Object.keys(config);
	const stacked = keys.length > 1;
	const isEmpty = (index: number) =>
		keys.every((key) => (data[index]?.[key] ?? 0) === 0);
	return (
		<ChartContainer
			config={config}
			initialDimension={{ width: 200, height: 40 }}
			className="pointer-events-none aspect-auto h-10 w-full"
			aria-hidden="true"
		>
			<BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
				{/* All zero leaves an empty domain, and Recharts draws no bars. */}
				<YAxis hide domain={[0, (max: number) => Math.max(max, 1)]} />
				{keys.map((key, index) => (
					<Bar
						key={key}
						dataKey={key}
						stackId={stacked ? "spark" : undefined}
						fill={`var(--color-${key})`}
						radius={stacked ? 0 : 2}
						minPointSize={(value, point) =>
							value || (index === 0 && isEmpty(point)) ? 1 : 0
						}
						isAnimationActive={false}
					/>
				))}
			</BarChart>
		</ChartContainer>
	);
}

/**
 * How a card's number compares with an earlier one: "2 more than the 24
 * hours before". Plain words, so it needs no tooltip.
 */
function Trend({
	now,
	before,
	than,
	format = String,
	fewer = "fewer",
}: {
	now: number;
	before: number;
	/** The earlier moment or period, as it ends the sentence. */
	than: string;
	format?: (difference: number) => string;
	/** The word for a drop: "fewer" for counts, "less" for money. */
	fewer?: string;
}) {
	const difference = now - before;
	const Icon =
		difference > 0
			? TrendingUpIcon
			: difference < 0
				? TrendingDownIcon
				: MinusIcon;
	return (
		<span className="flex items-center gap-1 text-muted-foreground text-xs tabular-nums">
			<Icon className="size-3.5 shrink-0" aria-hidden="true" />
			<span className="truncate">
				{difference === 0
					? `Same as ${than}`
					: `${format(Math.abs(difference))} ${difference > 0 ? "more" : fewer} than ${than}`}
			</span>
		</span>
	);
}

function StatCard({
	label,
	value,
	trend,
	badge,
	chart,
	headline,
	footer,
	onOpen,
	className,
}: {
	label: string;
	/** Null while loading. */
	value: ReactNode | null;
	/** How the number compares with an earlier one, below it. */
	trend?: ReactNode;
	badge?: ReactNode;
	/** A small chart between the number and the footer. */
	chart?: ReactNode;
	headline: ReactNode;
	footer: ReactNode;
	/** Makes the whole card a button that opens details. */
	onOpen?: () => void;
	className?: string;
}) {
	return (
		<Card
			className={cn(
				"@container/card",
				onOpen &&
					"relative transition-colors hover:bg-muted/40 has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-ring/50",
				className,
			)}
		>
			<CardHeader className="@max-[250px]/card:grid-cols-1!">
				<CardDescription>
					{onOpen ? (
						// The button covers the card, so the card is one target.
						<button
							type="button"
							onClick={onOpen}
							className="cursor-pointer outline-none after:absolute after:inset-0"
						>
							{label}
							<span className="sr-only">, show details</span>
						</button>
					) : (
						label
					)}
				</CardDescription>
				<CardTitle className="font-semibold @[250px]/card:text-3xl text-2xl tabular-nums">
					{value === null ? <Skeleton className="h-9 w-20" /> : value}
				</CardTitle>
				{value !== null && trend ? trend : null}
				{badge ? (
					<CardAction className="@max-[250px]/card:hidden">{badge}</CardAction>
				) : null}
			</CardHeader>
			{chart !== undefined ? (
				<CardContent>
					{chart === null ? <Skeleton className="h-10 w-full" /> : chart}
				</CardContent>
			) : null}
			<CardFooter className="flex-col items-start gap-1.5 text-sm">
				<div className="line-clamp-1 font-medium">{headline}</div>
				<div className="line-clamp-1 @max-[250px]/card:hidden text-muted-foreground">
					{footer}
				</div>
			</CardFooter>
		</Card>
	);
}
