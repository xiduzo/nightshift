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
	MoonIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { Bar, BarChart, YAxis } from "recharts";
import {
	activePerHour,
	HOUR_MS,
	lastHours,
} from "@/components/dashboard/activity";
import { ActivityDialog } from "@/components/dashboard/activity-dialog";
import { GatesDialog } from "@/components/dashboard/gates-dialog";
import { RunsDialog } from "@/components/dashboard/runs-dialog";
import { SpendDialog } from "@/components/dashboard/spend-dialog";

import { useNow } from "@/hooks/use-now";
import { useOpenGates } from "@/hooks/use-open-gates";
import type { OpenGate, Project, RunSummary } from "@/lib/api-types";
import { formatCost, formatDateTime, formatTime } from "@/lib/format";
import { lastNights, nightOf } from "@/lib/nights";

const DAY_MS = 24 * HOUR_MS;
const SPARK_NIGHTS = 14;
const SPARK_HOURS = 24;
/** Which card's details are open. */
type Details = "activity" | "gates" | "spend" | "runs";
const SPEND_CONFIG = {
	cost: { label: "Spend", color: "var(--chart-2)" },
} satisfies ChartConfig;
const ACTIVE_CONFIG = {
	active: { label: "Active runs", color: "var(--status-running)" },
} satisfies ChartConfig;
const GATES_CONFIG = {
	gates: { label: "Open Gates", color: "var(--status-waiting)" },
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
 * The numbers on top, as in the shadcn `dashboard-01` block, from runs and
 * open Gates. Over all projects, or over one when `project` is given. Each
 * card opens its details.
 */
export function SectionCards({
	runs,
	isLoading,
	project,
	projects,
}: {
	runs: RunSummary[] | undefined;
	isLoading: boolean;
	project?: Project;
	/** To name the project of each run in the details. */
	projects?: Project[];
}) {
	const projectId = project?.id;
	const gates = useOpenGates();
	const [details, setDetails] = useState<Details | null>(null);
	const detailsProps = (of: Details) => ({
		open: details === of,
		onOpenChange: (open: boolean) => setDetails(open ? of : null),
	});
	const now = useNow(60_000);
	const all = runs ?? [];
	const running = all.filter((run) => run.status === "running").length;
	const sleeping = all.filter((run) => run.status === "sleeping");
	// The one that wakes first.
	const nextWake = sleeping
		.flatMap((run) => (run.wakeAt ? [run.wakeAt] : []))
		.sort((a, b) => a - b)[0];
	const lastDay = all.filter((run) => run.createdAt >= now - DAY_MS);
	const spent = lastDay.reduce((sum, run) => sum + run.costUsd, 0);
	const spentAll = all.reduce((sum, run) => sum + run.costUsd, 0);
	const finished = lastDay.filter((run) => run.status === "finished").length;
	const failed = lastDay.filter((run) => run.status === "failed").length;
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
					value={isLoading ? null : running}
					chart={isLoading ? null : <ActiveSparkline runs={all} now={now} />}
					badge={
						sleeping.length > 0 ? (
							<Badge
								variant="outline"
								className="border-status-sleeping/40 bg-status-sleeping/10 text-status-sleeping"
							>
								<MoonIcon aria-hidden="true" />
								{sleeping.length} sleeping
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
					chart={
						gates.isLoading ? null : (
							<GatesSparkline gates={openGates} now={now} />
						)
					}
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
					footer="Runs pause at a Gate for you"
				/>
				<StatCard
					label="Spent, last 24 h"
					onOpen={() => setDetails("spend")}
					value={isLoading ? null : formatCost(spent)}
					chart={isLoading ? null : <SpendSparkline runs={all} now={now} />}
					badge={
						<Badge variant="outline" className="tabular-nums">
							{lastDay.length} {lastDay.length === 1 ? "run" : "runs"}
						</Badge>
					}
					headline={projectId ? "In this project" : "Over all projects"}
					footer={
						<>
							All time{" "}
							<span className="tabular-nums">{formatCost(spentAll)}</span>
						</>
					}
				/>
				<StatCard
					label="Runs, last 24 h"
					onOpen={() => setDetails("runs")}
					value={isLoading ? null : lastDay.length}
					chart={isLoading ? null : <OutcomesSparkline runs={all} now={now} />}
					badge={
						failed > 0 ? (
							<Badge variant="destructive" className="tabular-nums">
								<CircleXIcon aria-hidden="true" />
								{failed} failed
							</Badge>
						) : lastDay.length > 0 ? (
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
						lastDay.length - finished - failed > 0
							? `${lastDay.length - finished - failed} stopped, running or waiting`
							: "Started in the last day"
					}
				/>
			</div>
			<ActivityDialog
				{...detailsProps("activity")}
				runs={all}
				project={project}
				projects={projects}
			/>
			<GatesDialog
				{...detailsProps("gates")}
				gates={openGates}
				project={project}
			/>
			<SpendDialog
				{...detailsProps("spend")}
				runs={all}
				project={project}
				projects={projects}
			/>
			<RunsDialog
				{...detailsProps("runs")}
				runs={all}
				project={project}
				projects={projects}
			/>
		</>
	);
}

/** Spend per night over the last two weeks. */
function SpendSparkline({ runs, now }: { runs: RunSummary[]; now: number }) {
	const data = lastNights(SPARK_NIGHTS, now).map((night) => ({
		cost: runs
			.filter((run) => nightOf(run.createdAt) === night)
			.reduce((sum, run) => sum + run.costUsd, 0),
	}));
	return <Sparkline data={data} config={SPEND_CONFIG} />;
}

/** How many runs were at work in each of the last 24 hours. */
function ActiveSparkline({ runs, now }: { runs: RunSummary[]; now: number }) {
	return (
		<Sparkline
			data={activePerHour(runs, SPARK_HOURS, now).map(({ active }) => ({
				active,
			}))}
			config={ACTIVE_CONFIG}
		/>
	);
}

/**
 * The open Gates by the hour they opened, over the last 24 hours: how long
 * the inbox has waited. Older Gates count in the first hour.
 */
function GatesSparkline({ gates, now }: { gates: OpenGate[]; now: number }) {
	const hours = lastHours(SPARK_HOURS, now);
	const first = hours[0] ?? now;
	const data = hours.map((hour) => ({
		gates: gates.filter((gate) => {
			const opened = Math.max(gate.openedAt, first);
			return opened >= hour && opened < hour + HOUR_MS;
		}).length,
	}));
	return <Sparkline data={data} config={GATES_CONFIG} />;
}

/** Runs per night over the last two weeks, by how they ended. */
function OutcomesSparkline({ runs, now }: { runs: RunSummary[]; now: number }) {
	const data = lastNights(SPARK_NIGHTS, now).map((night) => {
		const ofNight = runs.filter((run) => nightOf(run.createdAt) === night);
		const finished = ofNight.filter((run) => run.status === "finished").length;
		const failed = ofNight.filter((run) => run.status === "failed").length;
		return { finished, failed, other: ofNight.length - finished - failed };
	});
	return <Sparkline data={data} config={OUTCOMES_CONFIG} />;
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

function StatCard({
	label,
	value,
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
