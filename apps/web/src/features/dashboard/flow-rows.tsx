import {
	type AttentionCause,
	causeLabel,
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
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
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
import { type ReactNode, useMemo, useState } from "react";
import type { FlowHealthRow, NightRange, Project } from "@/shared/api";
import {
	formatCost,
	formatDuration,
	formatRelative,
	useNow,
} from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { CostCell, LastRuns, TimeCell } from "./flow-cells";
import { dashboardQueries } from "./queries";
import { RUN_STATUS_CHART } from "./run-statuses";
import { LevelBadge, SignalIcon, WeekBars } from "./watch-parts";

const GRID =
	"grid grid-cols-[1.25rem_minmax(12rem,1.3fr)_9rem_10rem_minmax(16rem,1.4fr)] items-center gap-6 px-4";

/** The most places an opened row shows. */
const MAX_PLACES = 4;

/**
 * Each flow of a project over the page's range, one row each: its level,
 * its last runs, how often it needed you without a plan, and how steady
 * the time and the cost of a run are, one above the other. The flows that needed you most come
 * first. A row opens only when the flow has a place to improve, and then
 * it shows only those places. A test run does not count.
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
			<Empty>
				<EmptyHeader>
					<EmptyTitle>No flow yet</EmptyTitle>
					<EmptyDescription>
						Add a flow, then come back here after its first runs.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<div className="overflow-x-auto">
			<div className="min-w-[58rem]">
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
					<span>Predictability</span>
				</div>
				{sorted.map((row) => {
					const opens = hasPlaces(row);
					const open = opens && openName === row.name;
					const cells = (
						<>
							{opens ? (
								<ChevronRightIcon
									className={cn(
										"size-4 text-muted-foreground transition-transform",
										open && "rotate-90",
									)}
									aria-hidden="true"
								/>
							) : (
								<span />
							)}
							<span className="flex min-w-0 flex-col items-start gap-1">
								<span className="flex max-w-full items-center gap-1.5">
									<Link
										to="/projects/$projectId/flows/$name"
										params={{ projectId: project.id, name: row.name }}
										// Inside a row that opens, the name opens only its flow.
										onClick={(event) => event.stopPropagation()}
										className="min-w-0 truncate font-medium font-mono outline-none hover:underline focus-visible:underline"
									>
										{row.name}
									</Link>
									{(row.watch?.signals ?? []).map((signal) => (
										<Tooltip key={signal.kind}>
											<TooltipTrigger render={<span className="shrink-0" />}>
												<SignalIcon signal={signal} />
												<span className="sr-only">{signalTitle(signal)}</span>
											</TooltipTrigger>
											<TooltipContent>{signalTitle(signal)}</TooltipContent>
										</Tooltip>
									))}
								</span>
								<LevelLine watch={row.watch} now={now} />
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
							<span className="flex flex-col gap-1">
								<TimeCell
									steadiness={row.steady?.time}
									length={row.watch?.length}
								/>
								<CostCell
									steadiness={row.steady?.cost}
									cost={row.cost}
									tokenUse={row.tokenUse}
									unfinished={row.unfinished}
									unknownCost={row.unknownCost}
									freeRuns={row.freeRuns}
								/>
							</span>
						</>
					);
					if (!opens) {
						return (
							<div
								key={row.name}
								className={cn(GRID, "border-b py-3 text-sm last:border-b-0")}
							>
								{cells}
							</div>
						);
					}
					return (
						<Collapsible
							key={row.name}
							open={open}
							onOpenChange={(next) => setOpenName(next ? row.name : undefined)}
							className="border-b last:border-b-0"
						>
							<CollapsibleTrigger
								// A row holds links (its name, its last runs): it cannot be a button.
								nativeButton={false}
								render={<div />}
								className={cn(
									GRID,
									"w-full cursor-pointer py-3 text-left text-sm outline-none hover:bg-muted/50 focus-visible:bg-muted/50",
								)}
							>
								{cells}
							</CollapsibleTrigger>
							<CollapsibleContent>
								{open ? (
									<Places project={project} row={row} range={range} />
								) : null}
							</CollapsibleContent>
						</Collapsible>
					);
				})}
			</div>
		</div>
	);
}

/**
 * A row opens only when the flow has a place to improve: something
 * unusual, a time it needed you, or a run that did not finish. What came
 * out opens it too: the numbers a flow writes about its own work, and how
 * many runs people found useful.
 */
function hasPlaces(row: FlowHealthRow): boolean {
	return (
		(row.watch?.signals.length ?? 0) > 0 ||
		(row.watch?.attention.causes.length ?? 0) > 0 ||
		row.unfinished.count > 0 ||
		(row.scores?.length ?? 0) > 0 ||
		(row.useful?.answered ?? 0) > 0
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
 * How often the flow needed you without a plan per week, and under the
 * bars the number against the days before. The planned times show on hover. An older Host sends
 * nothing: a dash.
 */
function NeededCell({ watch }: { watch: FlowWatch | undefined }) {
	if (!watch) return <span className="text-muted-foreground">—</span>;
	const { attention } = watch;
	return (
		<Tooltip>
			<TooltipTrigger
				render={<span className="flex w-fit flex-col items-start gap-1.5" />}
			>
				<WeekBars weeks={attention.perWeek} />
				<span className="flex items-baseline gap-2">
					<span className="font-semibold text-lg tabular-nums leading-none">
						{attention.unplanned}
					</span>
					<Against
						now={attention.unplanned}
						before={attention.before.unplanned}
					/>
				</span>
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

/** One place to improve: how often, what, one line of evidence, and one link. */
function Place({
	times,
	title,
	evidence,
	link,
}: {
	times?: number;
	title: ReactNode;
	evidence?: ReactNode;
	link?: ReactNode;
}) {
	return (
		<div className="flex items-baseline gap-3 text-sm">
			<span className="w-8 shrink-0 text-right font-semibold tabular-nums">
				{times === undefined ? "" : `${times}×`}
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span>{title}</span>
				{evidence ? (
					<span className="text-muted-foreground text-xs">{evidence}</span>
				) : null}
			</span>
			{link}
		</div>
	);
}

function RunLink({ runId, children }: { runId: string; children: string }) {
	return (
		<Button
			size="xs"
			variant="link"
			className="h-auto shrink-0 px-0"
			nativeButton={false}
			render={<Link to="/runs/$runId" params={{ runId }} />}
		>
			{children}
		</Button>
	);
}

/** What you did and where: "You answered a Gate at approve: “Send these?”". */
function Cause({ cause }: { cause: AttentionCause }) {
	return (
		<>
			{causeLabel(cause)}
			{cause.nodeId ? (
				<>
					{" at "}
					<span className="font-mono">{cause.nodeId}</span>
				</>
			) : null}
			{cause.question ? (
				<span className="text-muted-foreground">: “{cause.question}”</span>
			) : null}
		</>
	);
}

/** A number a flow writes as a short number: whole as it is, else two decimals. */
function formatMetric(value: number): string {
	return Number.isInteger(value)
		? String(value)
		: value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * The opened row: the places to improve, the most pressing first. What is
 * unusual, where the flow needed you without a plan, why runs did not
 * finish, a warning that more than one run shares, and last the times it
 * asked you as planned. Under them, what came out: the numbers the flow
 * writes about its own work, and how many runs people found useful.
 */
function Places({
	project,
	row,
	range,
}: {
	project: Project;
	row: FlowHealthRow;
	range: NightRange;
}) {
	const detail = useQuery(dashboardQueries.flow(project.id, row.name));
	const inRange = detail.data?.ranges.find((r) => r.nights === range);
	const flowLink = (
		<Button
			size="xs"
			variant="link"
			className="h-auto shrink-0 px-0"
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
	);
	const causes = row.watch?.attention.causes ?? [];
	const places: ReactNode[] = [];
	for (const signal of row.watch?.signals ?? []) {
		const facts = signalFacts(signal, {
			cost: formatCost,
			time: formatDuration,
		});
		places.push(
			<Place
				key={`signal-${signal.kind}`}
				title={
					<span className="flex items-center gap-1.5">
						<SignalIcon signal={signal} />
						{signalTitle(signal)}
					</span>
				}
				evidence={facts ? `Usual: ${facts.usual}. Now: ${facts.now}.` : null}
				link={<RunLink runId={signal.runId}>Open the run</RunLink>}
			/>,
		);
	}
	for (const cause of causes.filter((c) => !c.planned)) {
		places.push(
			<Place
				key={`cause-${cause.reason}-${cause.nodeId ?? ""}`}
				times={cause.times}
				title={<Cause cause={cause} />}
				evidence="Without a plan."
				link={flowLink}
			/>,
		);
	}
	if (row.unfinished.count > 0) {
		const reason = inRange?.whyUnfinished.rows[0];
		const last = inRange?.latest.find((run) => run.status !== "finished");
		places.push(
			<Place
				key="unfinished"
				times={row.unfinished.count}
				title={
					row.unfinished.count === 1
						? "A run did not finish"
						: "Runs did not finish"
				}
				evidence={
					reason
						? `Most often: ${reason.reason ?? RUN_STATUS_CHART[reason.status].label} (${reason.runs}×).`
						: null
				}
				link={
					last ? <RunLink runId={last.runId}>Open the last one</RunLink> : null
				}
			/>,
		);
	}
	for (const warning of (inRange?.warningRows.rows ?? []).filter(
		(w) => w.runs > 1,
	)) {
		places.push(
			<Place
				key={`warning-${warning.key}`}
				times={warning.runs}
				title={
					<>
						The same warning
						{warning.nodeId ? (
							<>
								{" at "}
								<span className="font-mono">{warning.nodeId}</span>
							</>
						) : null}
					</>
				}
				evidence={warning.message}
				link={<RunLink runId={warning.last.runId}>Open the last one</RunLink>}
			/>,
		);
	}
	for (const cause of causes.filter((c) => c.planned)) {
		places.push(
			<Place
				key={`planned-${cause.reason}-${cause.nodeId ?? ""}`}
				times={cause.times}
				title={<Cause cause={cause} />}
				evidence="As planned."
				link={flowLink}
			/>,
		);
	}
	const hidden = places.length - MAX_PLACES;
	const scores = row.scores ?? [];
	const useful = row.useful;
	return (
		<div className="flex max-w-4xl flex-col gap-3 bg-muted/30 px-4 py-4 pl-13">
			{places.slice(0, MAX_PLACES)}
			{hidden > 0 ? (
				<span className="pl-11 text-muted-foreground text-xs">
					And {hidden} more.
				</span>
			) : null}
			{scores.length > 0 ? (
				<p className="pl-11 text-muted-foreground text-xs">
					What it counted per run:{" "}
					{scores
						.map((score) => `${score.name} ${formatMetric(score.mean)}`)
						.join(", ")}
					.
				</p>
			) : null}
			{useful && useful.answered > 0 ? (
				<p className="pl-11 text-muted-foreground text-xs">
					{useful.useful} of {useful.answered}{" "}
					{useful.answered === 1 ? "run" : "runs"} with an answer{" "}
					{useful.answered === 1 ? "was" : "were"} useful.
				</p>
			) : null}
		</div>
	);
}
