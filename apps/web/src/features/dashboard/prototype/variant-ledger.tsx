/**
 * PROTOTYPE, throw away. Variant C, "Night ledger": time is the axis. Two
 * pictures and no stat cards: tonight as a noon-to-noon strip, and each flow
 * as a row of nights, like a CI status grid.
 */

import { runStatusLabel } from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { Card, CardContent } from "@nightshift/ui/components/card";
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
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { scheduleQueries } from "@/features/schedules";
import type { FlowRange, RunStatus } from "@/shared/api";
import {
	formatCost,
	formatRelative,
	formatTime,
	useNow,
} from "@/shared/format";
import { PageSection } from "@/shared/page";
import { formatNight, formatNightShort } from "../nights";
import type { VariantProps } from "../project-dashboard-page";
import { dashboardQueries } from "../queries";
import { RangeBar, useDashboardRange } from "./range-bar";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Worst first: the colour a night with several runs takes. */
const WORST: RunStatus[] = [
	"failed",
	"interrupted",
	"stopped",
	"waiting",
	"sleeping",
	"running",
	"finished",
];

const STATUS_BG: Record<RunStatus, string> = {
	running: "bg-status-running",
	waiting: "bg-status-waiting",
	sleeping: "bg-status-sleeping",
	finished: "bg-status-finished",
	failed: "bg-status-failed",
	interrupted: "bg-status-interrupted",
	stopped: "bg-status-stopped",
};

const ENDED: RunStatus[] = ["finished", "failed", "interrupted", "stopped"];

export function VariantLedger({ project, summary, isLoading }: VariantProps) {
	return (
		<>
			<RangeBar />
			<TonightStrip projectId={project.id} summary={summary} />
			<FlowsByNight
				projectId={project.id}
				summary={summary}
				isLoading={isLoading}
			/>
		</>
	);
}

/** The latest noon at or before `at`: where a night starts on this clock. */
function noonBefore(at: number): number {
	const noon = new Date(at);
	noon.setHours(12, 0, 0, 0);
	return noon.getTime() > at ? noon.getTime() - DAY : noon.getTime();
}

/** Where `at` falls on a noon-to-noon strip, in percent. */
function offset(at: number, start: number): number {
	return Math.min(100, Math.max(0, ((at - start) / DAY) * 100));
}

type Pin = {
	key: string;
	at: number;
	label: string;
	kind: string;
	link: { to: string; params: Record<string, string> };
};

function TonightStrip({
	projectId,
	summary,
}: {
	projectId: string;
	summary: VariantProps["summary"];
}) {
	const now = useNow(60_000);
	const schedules = useQuery(scheduleQueries.listLive(projectId));
	const tonight = noonBefore(now);
	const lastNight = summary?.lastNight;
	const lastStart = lastNight?.night ?? tonight - DAY;

	const pins: Pin[] = [
		...(schedules.data?.schedules ?? []).flatMap((schedule) =>
			schedule.enabled && schedule.nextAt
				? [
						{
							key: `schedule:${schedule.id}`,
							at: schedule.nextAt,
							label: schedule.flow ?? schedule.id,
							kind: "Starts on schedule",
							link: {
								to: "/projects/$projectId/schedules",
								params: { projectId },
							},
						},
					]
				: [],
		),
		...(summary?.upNext ?? []).map((item) => ({
			key: `${item.kind}:${item.runId}`,
			at: item.at,
			label: item.title,
			kind: item.kind === "wake" ? "Wakes and goes on" : "Stop time",
			link: { to: "/runs/$runId", params: { runId: item.runId } },
		})),
	].filter((pin) => pin.at >= now);
	const inWindow = pins.filter((pin) => pin.at < tonight + DAY);
	const later = pins.length - inWindow.length;

	return (
		<PageSection
			title="Tonight"
			description={
				later > 0
					? `From noon to noon. ${later} more ${later === 1 ? "start waits" : "starts wait"} after this night.`
					: "From noon to noon. What ran last night, and what starts next."
			}
		>
			<Card size="sm">
				<CardContent className="flex flex-col gap-3">
					<Lane label={lastNight ? formatNight(lastStart) : "Last night"}>
						{(lastNight?.latest ?? []).map((run) => (
							<Tooltip key={run.id}>
								<TooltipTrigger
									render={
										<Link
											to="/runs/$runId"
											params={{ runId: run.id }}
											className={cn(
												"absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background",
												STATUS_BG[run.status],
											)}
											style={{ left: `${offset(run.createdAt, lastStart)}%` }}
											aria-label={`${run.title}, ${runStatusLabel(run.status)}`}
										/>
									}
								/>
								<TooltipContent className="max-w-80">
									<p className="font-medium">
										{run.title} · {formatTime(run.createdAt)}
									</p>
									<p>{run.reason ?? runStatusLabel(run.status)}</p>
								</TooltipContent>
							</Tooltip>
						))}
					</Lane>
					<Lane label={`Tonight, ${formatNight(tonight)}`}>
						<div
							className="absolute inset-y-0 left-0 bg-muted/60"
							style={{ width: `${offset(now, tonight)}%` }}
						/>
						<div
							className="absolute inset-y-[-4px] w-0.5 bg-status-running"
							style={{ left: `${offset(now, tonight)}%` }}
							title={`Now, ${formatTime(now)}`}
						/>
						{inWindow.map((pin) => (
							<Tooltip key={pin.key}>
								<TooltipTrigger
									render={
										<Link
											// biome-ignore lint/suspicious/noExplicitAny: PROTOTYPE, the pins mix two routes.
											{...(pin.link as any)}
											className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-foreground"
											style={{ left: `${offset(pin.at, tonight)}%` }}
											aria-label={`${pin.label}, ${pin.kind} at ${formatTime(pin.at)}`}
										/>
									}
								/>
								<TooltipContent>
									<p className="font-medium">
										{pin.label} · {formatTime(pin.at)}
									</p>
									<p>{pin.kind}</p>
								</TooltipContent>
							</Tooltip>
						))}
					</Lane>
					<HourTicks />
				</CardContent>
			</Card>
		</PageSection>
	);
}

function Lane({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="grid grid-cols-[10rem_1fr] items-center gap-3">
			<span className="truncate text-muted-foreground text-xs">{label}</span>
			<div className="relative h-6 rounded-md border bg-card">{children}</div>
		</div>
	);
}

function HourTicks() {
	// 12:00, 15:00 … 12:00: every three hours from noon.
	const hours = Array.from({ length: 9 }, (_, i) => (12 + i * 3) % 24);
	return (
		<div className="grid grid-cols-[10rem_1fr] gap-3">
			<span />
			<div className="relative h-4 text-[10px] text-muted-foreground tabular-nums">
				{hours.map((hour, i) => (
					<span
						key={`${hour}-${i}`}
						className={cn(
							"absolute",
							i === 0 ? "" : i === 8 ? "-translate-x-full" : "-translate-x-1/2",
						)}
						style={{ left: `${(i / 8) * 100}%` }}
					>
						{String(hour).padStart(2, "0")}:00
					</span>
				))}
			</div>
		</div>
	);
}

type DetailRange = FlowRange;
/** One flow in detail, per range. */
type FlowHealthDetail = { ranges: FlowRange[] };

/** Finished out of ended runs, over a run of nights. */
function finishedRate(perNight: DetailRange["perNight"]): number | null {
	let finished = 0;
	let ended = 0;
	for (const { counts } of perNight) {
		finished += counts.finished ?? 0;
		for (const status of ENDED) ended += counts[status] ?? 0;
	}
	return ended === 0 ? null : finished / ended;
}

function formatRate(rate: number | null): string {
	return rate === null ? "–" : `${Math.round(rate * 100)}%`;
}

function FlowsByNight({
	projectId,
	summary,
	isLoading,
}: {
	projectId: string;
	summary: VariantProps["summary"];
	isLoading: boolean;
}) {
	const now = useNow(60_000);
	const { range, compare } = useDashboardRange();
	const nights = range === "24h" ? 7 : range;
	const flows = summary?.flowHealth?.rows ?? [];
	const details = useQueries({
		queries: flows.map((flow) => dashboardQueries.flow(projectId, flow.name)),
	});

	const description =
		range === "24h"
			? "The busiest flows, night by night. The last 24 hours show the last 7 nights here."
			: `The busiest flows over the last ${nights} nights. A square is one night. Its colour is the worst way a run ended.`;

	return (
		<PageSection
			title="Flows by night"
			description={description}
			actions={<Legend />}
		>
			<Card size="sm">
				<CardContent className="flex flex-col gap-2 overflow-x-auto">
					{isLoading ? (
						Array.from({ length: 4 }, (_, i) => (
							<Skeleton key={i} className="h-7 w-full" />
						))
					) : flows.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyTitle>No runs in this range</EmptyTitle>
								<EmptyDescription>
									Run a flow or add a schedule. Each night it runs shows up
									here.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<>
							<GridRow
								head={<span />}
								cells={nightLabels(details.find((d) => d.data)?.data, nights)}
								tail={
									<>
										<span>Finished</span>
										<span>Per finished run</span>
										<span>Last run</span>
									</>
								}
								className="text-[10px] text-muted-foreground"
							/>
							{flows.map((flow, index) => {
								const detail = details[index]?.data;
								const current = detail?.ranges.find((r) => r.nights === nights);
								const before = earlierRate(detail, nights);
								return (
									<GridRow
										key={flow.name}
										head={
											<Link
												to="/projects/$projectId/flows/$name"
												params={{ projectId, name: flow.name }}
												className="truncate font-mono text-xs hover:underline"
											>
												{flow.name}
											</Link>
										}
										cells={
											current ? (
												current.perNight.map((night) => (
													<NightCell
														key={night.night}
														night={night}
														runs={current.endedRuns.filter(
															(run) => run.night === night.night,
														)}
														showCount={nights <= 30}
													/>
												))
											) : (
												<Skeleton className="col-span-full h-5" />
											)
										}
										tail={
											<>
												<span className="tabular-nums">
													{current
														? formatRate(finishedRate(current.perNight))
														: "–"}
													{compare ? (
														<span className="ml-1 text-muted-foreground">
															(was{" "}
															{before === undefined ? "–" : formatRate(before)})
														</span>
													) : null}
												</span>
												<span className="tabular-nums">
													{current?.cost
														? formatCost(current.cost.median)
														: "–"}
												</span>
												<span className="text-muted-foreground">
													{flow.last
														? formatRelative(flow.last.startedAt, now)
														: "–"}
												</span>
											</>
										}
									/>
								);
							})}
						</>
					)}
				</CardContent>
			</Card>
		</PageSection>
	);
}

/** The finished rate of the same number of nights just before, from the next longer range. */
function earlierRate(
	detail: FlowHealthDetail | undefined,
	nights: 7 | 30 | 90,
): number | null | undefined {
	const longer = detail?.ranges.find(
		(r) => r.nights === (nights === 7 ? 30 : 90),
	);
	if (!longer || nights === 90) return undefined;
	const perNight = longer.perNight;
	return finishedRate(perNight.slice(-2 * nights, -nights));
}

function nightLabels(detail: FlowHealthDetail | undefined, nights: number) {
	const perNight = detail?.ranges.find((r) => r.nights === nights)?.perNight;
	if (!perNight) return null;
	const every = nights <= 7 ? 1 : nights <= 30 ? 5 : 15;
	return perNight.map(({ night }, i) => (
		<span key={night} className="truncate text-center">
			{(perNight.length - 1 - i) % every === 0 ? formatNightShort(night) : ""}
		</span>
	));
}

function GridRow({
	head,
	cells,
	tail,
	className,
}: {
	head: React.ReactNode;
	cells: React.ReactNode;
	tail: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"grid min-w-[48rem] grid-cols-[10rem_1fr_14rem] items-center gap-3",
				className,
			)}
		>
			{head}
			<div className="grid auto-cols-fr grid-flow-col gap-0.5">{cells}</div>
			<div className="grid grid-cols-3 gap-2 text-right text-xs">{tail}</div>
		</div>
	);
}

function NightCell({
	night,
	runs,
	showCount,
}: {
	night: DetailRange["perNight"][number];
	runs: DetailRange["endedRuns"];
	showCount: boolean;
}) {
	const total = Object.values(night.counts).reduce((a, b) => a + b, 0);
	const worst = WORST.find((status) => (night.counts[status] ?? 0) > 0);
	const label = `${formatNight(night.night)}: ${
		total === 0
			? "no runs"
			: WORST.filter((s) => (night.counts[s] ?? 0) > 0)
					.map((s) => `${night.counts[s]} ${runStatusLabel(s).toLowerCase()}`)
					.join(", ")
	}`;
	const square = cn(
		"flex h-6 items-center justify-center rounded-sm font-medium text-[10px] text-background tabular-nums",
		worst ? STATUS_BG[worst] : "bg-muted/50",
	);
	const latest = runs.at(-1);

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					latest ? (
						<Link
							to="/runs/$runId"
							params={{ runId: latest.runId }}
							className={square}
							aria-label={label}
						/>
					) : (
						<span className={square} role="img" aria-label={label} />
					)
				}
			>
				{showCount && total > 1 ? total : null}
			</TooltipTrigger>
			<TooltipContent>
				<p className="font-medium">{label}</p>
				{runs.map((run) => (
					<p key={run.runId}>
						{formatTime(run.startedAt)} · {runStatusLabel(run.status)} ·{" "}
						{formatCost(run.costUsd)}
					</p>
				))}
			</TooltipContent>
		</Tooltip>
	);
}

function Legend() {
	return (
		<div className="flex flex-wrap items-center gap-1">
			{(["finished", "failed", "stopped", "waiting"] as const).map((status) => (
				<Badge key={status} variant="outline" className="gap-1.5">
					<span className={cn("size-2 rounded-sm", STATUS_BG[status])} />
					{runStatusLabel(status)}
				</Badge>
			))}
			<Badge variant="outline" className="gap-1.5">
				<span className="size-2 rounded-sm bg-muted" />
				No runs
			</Badge>
		</div>
	);
}
