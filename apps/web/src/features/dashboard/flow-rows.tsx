import { type FlowWatch, signalTitle } from "@nightshift/client";
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
import { Link } from "@tanstack/react-router";
import { ArrowDownIcon, ArrowUpIcon, ChevronRightIcon } from "lucide-react";
import { useMemo, useState } from "react";
import type { FlowHealthRow, NightRange, Project } from "@/shared/api";
import { formatRelative, useNow } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { CostCell, LastRuns, TimeCell } from "./flow-cells";
import { FlowChanges } from "./flow-changes";
import { LevelBadge, SignalIcon, WeekBars } from "./watch-parts";

const GRID =
	"grid grid-cols-[1.25rem_minmax(12rem,1.3fr)_9rem_10rem_minmax(16rem,1.4fr)] items-center gap-6 px-4";

/**
 * Each flow of a project over the page's range, one row each: its level,
 * its last runs, how often it needed you without a plan, and how steady
 * the time and the cost of a run are, one above the other. The flows that
 * needed you most come first. A row with a run opens: what your changes
 * did, and what to change next (`FlowChanges`). A test run does not count.
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
					const opens = row.runs > 0;
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
									<FlowChanges project={project} row={row} range={range} />
								) : null}
							</CollapsibleContent>
						</Collapsible>
					);
				})}
			</div>
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
