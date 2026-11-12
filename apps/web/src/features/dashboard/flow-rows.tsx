import {
	type AttentionCause,
	causeLabel,
	type FlowSignal,
	type FlowWatch,
	signalFacts,
	signalTitle,
} from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon } from "lucide-react";
import { useMemo, useState } from "react";
import {
	type Machine,
	neededMachines,
	useSpaceMachines,
} from "@/features/devices";
import type { FlowHealthRow, NightRange, Project } from "@/shared/api";
import {
	formatCost,
	formatDuration,
	formatRelative,
	useNow,
} from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { ChartSection, DetailsEmpty } from "./details";
import { CostCell, LastRuns, Needs, UsefulCell } from "./flow-cells";
import { RunsPerDay } from "./flow-health-charts";
import { FlowHealthDialog } from "./flow-health-dialog";
import { LaddersCell } from "./flow-health-ladders";
import { LatestRuns, WhyUnfinished } from "./flow-health-tables";
import { dashboardQueries, projectFlowsQuery } from "./queries";
import { LevelBadge, SignalIcon, WeekBars } from "./watch-parts";

const GRID =
	"grid grid-cols-[1.25rem_minmax(12rem,1.4fr)_9rem_11rem_8rem_minmax(9rem,1fr)] items-center gap-4 px-4";

/**
 * Each flow of a project over the page's range, one row each: its level,
 * its last runs, how often it needed you without a plan, what a finished
 * run costs, and whether it needs a look. The flows that needed you most
 * come first. A row opens in place: how its runs went, why it needed you,
 * and where its work landed. A test run does not count.
 */
export function FlowRows({
	project,
	rows,
	range,
}: {
	project: Project;
	/** Undefined while they load. */
	rows: FlowHealthRow[] | undefined;
	range: NightRange;
}) {
	const now = useNow(60_000);
	const [openName, setOpenName] = useState<string>();
	// The name stays while the dialog closes, so its body does not go blank.
	const [details, setDetails] = useState<{ name: string; open: boolean }>();
	const flows = useQuery(projectFlowsQuery(project.id));
	const machines = useSpaceMachines();
	// The run's own computer is the one you start it on: only what the flow names.
	const needs = useMemo(() => {
		const out = new Map<string, Machine[]>();
		if (!machines) return out;
		for (const flow of flows.data ?? []) {
			out.set(flow.name, neededMachines(machines, false, flow.devices));
		}
		return out;
	}, [flows.data, machines]);
	const sorted = useMemo(
		() =>
			rows
				? [...rows].sort(
						(a, b) =>
							(b.watch?.attention.unplanned ?? 0) -
							(a.watch?.attention.unplanned ?? 0),
					)
				: undefined,
		[rows],
	);

	if (!sorted) {
		return (
			<div className="flex flex-col gap-2 px-4 py-4">
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
			</div>
		);
	}
	if (sorted.length === 0) {
		return (
			<div className="px-4 py-6">
				<DetailsEmpty>
					No flow yet. Add a flow, then come back here after its first runs.
				</DetailsEmpty>
			</div>
		);
	}

	return (
		<div className="overflow-x-auto">
			<div className="min-w-[56rem]">
				<div
					className={cn(
						GRID,
						"border-b py-2 font-medium text-muted-foreground text-xs",
					)}
				>
					<span />
					<span>Flow</span>
					<span>Last runs</span>
					<span>Needed you without a plan</span>
					<span className="text-right">Per finished run</span>
					<span>Needs a look</span>
				</div>
				{sorted.map((row) => {
					const open = openName === row.name;
					return (
						<Collapsible
							key={row.name}
							open={open}
							onOpenChange={(next) => setOpenName(next ? row.name : undefined)}
							className="border-b last:border-b-0"
						>
							<CollapsibleTrigger
								// A row holds links (its last runs): it cannot be a button.
								nativeButton={false}
								render={<div />}
								className={cn(
									GRID,
									"w-full cursor-pointer py-3 text-left text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50",
								)}
							>
								<ChevronRightIcon
									className={cn(
										"size-4 text-muted-foreground transition-transform",
										open && "rotate-90",
									)}
									aria-hidden="true"
								/>
								<span className="flex min-w-0 flex-col items-start gap-1">
									<span className="max-w-full truncate font-medium font-mono">
										{row.name}
									</span>
									<LevelLine watch={row.watch} now={now} />
									<Needs machines={needs.get(row.name) ?? []} />
								</span>
								<span className="flex flex-col gap-1">
									<LastRuns row={row} now={now} />
									{row.rate !== null ? (
										<span className="text-muted-foreground text-xs tabular-nums">
											{row.rate}% finished
										</span>
									) : null}
								</span>
								<NeededCell watch={row.watch} />
								<span className="text-right tabular-nums">
									<CostCell
										cost={row.cost}
										tokenUse={row.tokenUse}
										unfinished={row.unfinished}
										unknownCost={row.unknownCost}
										freeRuns={row.freeRuns}
									/>
								</span>
								<span className="flex min-w-0 flex-col gap-1">
									{(row.watch?.signals ?? []).map((signal) => (
										<span
											key={signal.kind}
											className="flex items-center gap-1.5 text-xs"
										>
											<SignalIcon signal={signal} />
											{signalTitle(signal)}
										</span>
									))}
								</span>
							</CollapsibleTrigger>
							<CollapsibleContent>
								{open ? (
									<FlowRowDetail
										project={project}
										row={row}
										range={range}
										now={now}
										onDetails={() => setDetails({ name: row.name, open: true })}
									/>
								) : null}
							</CollapsibleContent>
						</Collapsible>
					);
				})}
			</div>
			{details ? (
				<FlowHealthDialog
					open={details.open}
					onOpenChange={(next) => setDetails({ ...details, open: next })}
					flowName={details.name}
					project={project}
				/>
			) : null}
		</div>
	);
}

/** The level of the flow, and since when. Nothing from an older Host. */
function LevelLine({
	watch,
	now,
}: {
	watch: FlowWatch | undefined;
	now: number;
}) {
	if (!watch) return null;
	if (!watch.level) {
		return (
			<span className="text-muted-foreground text-xs">
				Too few runs for a level
			</span>
		);
	}
	return (
		<span className="flex items-center gap-2 text-muted-foreground text-xs">
			<LevelBadge level={watch.level.level} />
			<LocalTime at={watch.level.since}>
				since {formatRelative(watch.level.since, now)}
			</LocalTime>
		</span>
	);
}

/** A number against the days before: an arrow and the number then. Fewer is better. */
export function Against({ now, before }: { now: number; before: number }) {
	if (now === before) {
		return <span className="text-muted-foreground text-xs">as before</span>;
	}
	const Icon = now > before ? ArrowUpIcon : ArrowDownIcon;
	return (
		<span
			className={cn(
				"inline-flex items-center gap-0.5 text-xs",
				now < before ? "text-status-finished" : "text-status-failed",
			)}
		>
			<Icon className="size-3" aria-hidden="true" />
			from {before}
		</span>
	);
}

/**
 * How often the flow needed you without a plan, against the days before,
 * and per week. The planned times show on hover. An older Host sends
 * nothing: a dash.
 */
function NeededCell({ watch }: { watch: FlowWatch | undefined }) {
	if (!watch) return <span className="text-muted-foreground">—</span>;
	const { attention } = watch;
	return (
		<Tooltip>
			<TooltipTrigger render={<span className="flex items-end gap-2" />}>
				<span className="flex flex-col">
					<span className="font-semibold text-lg tabular-nums leading-none">
						{attention.unplanned}
					</span>
					<Against
						now={attention.unplanned}
						before={attention.before.unplanned}
					/>
				</span>
				<WeekBars weeks={attention.perWeek} className="ml-auto" />
			</TooltipTrigger>
			<TooltipContent className="flex flex-col items-start gap-0.5">
				<span>
					{attention.unplanned} {attention.unplanned === 1 ? "time" : "times"}{" "}
					without a plan.
				</span>
				<span>
					{attention.planned} {attention.planned === 1 ? "time" : "times"} as
					planned.
				</span>
				<span className="text-muted-foreground">The bars show 12 weeks.</span>
			</TooltipContent>
		</Tooltip>
	);
}

/**
 * The opened row: how the runs went on the left, why the flow needed you
 * and where its work landed on the right. The full details are one button
 * away.
 */
function FlowRowDetail({
	project,
	row,
	range,
	now,
	onDetails,
}: {
	project: Project;
	row: FlowHealthRow;
	range: NightRange;
	now: number;
	onDetails: () => void;
}) {
	const detail = useQuery(dashboardQueries.flow(project.id, row.name));
	const inRange = detail.data?.ranges.find((r) => r.nights === range);
	const causes = row.watch?.attention.causes ?? [];
	const unplanned = causes.filter((cause) => !cause.planned);
	const planned = causes.filter((cause) => cause.planned);
	return (
		<div className="grid gap-8 bg-muted/30 px-4 py-5 pl-13 lg:grid-cols-2">
			<div className="flex min-w-0 flex-col gap-6">
				{detail.error && !inRange ? (
					<DetailsEmpty>
						Night Shift could not load the runs of this flow. Close the row and
						open it again.
					</DetailsEmpty>
				) : !inRange ? (
					<Skeleton className="h-48 w-full" />
				) : inRange.runs === 0 ? (
					<DetailsEmpty>No run in the last {range} days.</DetailsEmpty>
				) : (
					<>
						<RunsPerDay
							perNight={inRange.perNight}
							statuses={inRange.statuses}
						/>
						{inRange.unfinished > 0 ? (
							<WhyUnfinished reasons={inRange.whyUnfinished} now={now} />
						) : null}
						<LatestRuns
							runs={inRange.latest}
							now={now}
							onNavigate={() => undefined}
						/>
					</>
				)}
			</div>
			<div className="flex min-w-0 flex-col gap-6">
				{(row.watch?.signals ?? []).map((signal) => (
					<SignalLine key={signal.kind} signal={signal} />
				))}
				{row.watch ? (
					<ChartSection
						title="Why it needed you"
						hint={`In the last ${range} days`}
					>
						{causes.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								It did not need you.
							</p>
						) : (
							<div className="flex flex-col gap-4">
								<Causes title="Without a plan" causes={unplanned} />
								<Causes title="As planned" causes={planned} />
							</div>
						)}
					</ChartSection>
				) : null}
				<ChartSection
					title="Where the work landed"
					hint={`In the last ${range} days`}
				>
					<LaddersCell ladders={row.ladders} />
				</ChartSection>
				<div className="grid grid-cols-2 gap-4 text-sm">
					<div className="flex flex-col gap-1">
						<span className="text-muted-foreground text-xs">
							Per useful result
						</span>
						<span className="tabular-nums">
							<UsefulCell useful={row.useful} />
						</span>
					</div>
					{row.watch?.length ? (
						<div className="flex flex-col gap-1">
							<span className="text-muted-foreground text-xs">
								Time of a finished run
							</span>
							<span className="tabular-nums">
								{formatDuration(row.watch.length.median)}
								<span className="block text-muted-foreground text-xs">
									{formatDuration(row.watch.length.min)} to{" "}
									{formatDuration(row.watch.length.max)}
								</span>
							</span>
						</div>
					) : null}
				</div>
				<div className="flex flex-wrap gap-2">
					<Button variant="outline" size="sm" onClick={onDetails}>
						All details
					</Button>
					<Button
						variant="ghost"
						size="sm"
						nativeButton={false}
						render={
							<Link
								to="/projects/$projectId/flows/$name"
								params={{ projectId: project.id, name: row.name }}
							/>
						}
					>
						Open the flow
					</Button>
				</div>
			</div>
		</div>
	);
}

/** One signal in an opened row: what is unusual, and its usual range in words. */
function SignalLine({ signal }: { signal: FlowSignal }) {
	const facts = signalFacts(signal, {
		cost: formatCost,
		time: formatDuration,
	});
	return (
		<div className="flex items-start gap-2 rounded-lg border bg-card p-3 text-sm">
			<SignalIcon signal={signal} />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="font-medium">{signalTitle(signal)}</span>
				{facts ? (
					<span className="text-muted-foreground">
						Usual: {facts.usual}. Now: {facts.now}.
					</span>
				) : null}
			</div>
			<Button
				size="xs"
				variant="outline"
				nativeButton={false}
				render={<Link to="/runs/$runId" params={{ runId: signal.runId }} />}
			>
				Open the run
			</Button>
		</div>
	);
}

/** The reasons of one kind, the most times first. Nothing without one. */
function Causes({
	title,
	causes,
}: {
	title: string;
	causes: AttentionCause[];
}) {
	if (causes.length === 0) return null;
	return (
		<div className="flex flex-col gap-1">
			<span className="text-muted-foreground text-xs">{title}</span>
			{causes.map((cause) => (
				<div
					key={`${cause.reason}-${cause.nodeId ?? ""}`}
					className="flex items-baseline gap-2 text-sm"
				>
					<span className="w-7 shrink-0 text-right font-medium tabular-nums">
						{cause.times}×
					</span>
					<span className="min-w-0">
						{causeLabel(cause)}
						{cause.question ? (
							<span className="text-muted-foreground">
								: “{cause.question}”
							</span>
						) : null}
					</span>
				</div>
			))}
		</div>
	);
}
