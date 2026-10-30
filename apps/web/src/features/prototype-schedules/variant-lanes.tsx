/**
 * PROTOTYPE, throw away. Variant C: a timeline with one lane per schedule.
 * Left of the now line, the runs it started, as long as they took and in
 * their status colour. Right of it, the starts to come, up to their stop
 * time. You see at a glance when runs overlap, how long a night takes,
 * and which nights failed.
 */

import { runStatusLabel } from "@nightshift/client";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { RunStatus } from "@/shared/api";
import { formatDateTime, formatDuration, formatTime } from "@/shared/format";
import {
	ErrorLines,
	FinishedShare,
	nextText,
	OnSwitch,
	ScheduleMenu,
	StartIcon,
	whenSentence,
} from "./schedule-parts";
import { DAY_MS, type ScheduleRow } from "./schedules-data";
import type { VariantProps } from "./schedules-prototype";

const BAR: Record<RunStatus, string> = {
	running: "bg-status-running",
	waiting: "bg-status-waiting",
	sleeping: "bg-status-sleeping",
	finished: "bg-status-finished",
	stopped: "bg-status-stopped",
	failed: "bg-status-failed",
	interrupted: "bg-status-interrupted",
};

type Range = "day" | "week";

const WINDOW: Record<Range, { before: number; after: number }> = {
	day: { before: 12 * 3600_000, after: 12 * 3600_000 },
	week: { before: 4 * DAY_MS, after: 3 * DAY_MS },
};

export function VariantLanes({ rows, now, schedulerOff }: VariantProps) {
	const [range, setRange] = useState<Range>("week");
	const from = now - WINDOW[range].before;
	const to = now + WINDOW[range].after;
	const pos = (ms: number) =>
		`${(Math.min(Math.max(ms, from), to) - from) / ((to - from) / 100)}%`;
	const width = (start: number, end: number) =>
		`max(3px, ${(Math.min(end, to) - Math.max(start, from)) / ((to - from) / 100)}%)`;

	const ticks: number[] = [];
	const step = range === "week" ? DAY_MS : 3 * 3600_000;
	const start = new Date(from);
	if (range === "week") start.setHours(24, 0, 0, 0);
	else start.setHours(start.getHours() + 3 - (start.getHours() % 3), 0, 0, 0);
	for (let at = start.getTime(); at < to; at += step) ticks.push(at);

	return (
		<Card className="py-0">
			<CardContent className="px-0">
				<div className="flex items-center justify-between gap-2 border-b px-4 py-3">
					<span className="text-muted-foreground text-xs">
						Past runs left of the line, coming starts right of it.
					</span>
					<ToggleGroup
						variant="outline"
						size="sm"
						value={[range]}
						spacing={0}
						onValueChange={(value) => {
							const next = value[0];
							if (next === "day" || next === "week") setRange(next);
						}}
					>
						<ToggleGroupItem value="day">24 hours</ToggleGroupItem>
						<ToggleGroupItem value="week">Week</ToggleGroupItem>
					</ToggleGroup>
				</div>

				{/* The time axis. */}
				<div className="grid grid-cols-[16rem_1fr_7rem] border-b text-muted-foreground text-xs">
					<div />
					<div className="relative h-8">
						{ticks.map((at) => (
							<span
								key={at}
								className="absolute top-2 -translate-x-1/2 whitespace-nowrap"
								style={{ left: pos(at) }}
							>
								{range === "week"
									? new Date(at).toLocaleDateString(undefined, {
											weekday: "short",
											day: "numeric",
										})
									: formatTime(at)}
							</span>
						))}
						<span
							className="absolute top-0 bottom-0 w-px bg-primary"
							style={{ left: pos(now) }}
						/>
					</div>
					<div className="px-4 py-2 text-right">Finished</div>
				</div>

				{rows.map((row) => (
					<Lane
						key={row.schedule.id}
						row={row}
						now={now}
						from={from}
						to={to}
						ticks={ticks}
						pos={pos}
						width={width}
						schedulerOff={schedulerOff}
					/>
				))}
			</CardContent>
		</Card>
	);
}

function Lane({
	row,
	now,
	from,
	to,
	ticks,
	pos,
	width,
	schedulerOff,
}: {
	row: ScheduleRow;
	now: number;
	from: number;
	to: number;
	ticks: number[];
	pos: (ms: number) => string;
	width: (start: number, end: number) => string;
	schedulerOff: boolean;
}) {
	const { schedule } = row;
	const past = row.runs.filter(
		(run) => (run.endedAt ?? now) >= from && run.createdAt <= to,
	);
	const coming = schedulerOff
		? []
		: row.upcoming.filter((at) => at > now && at <= to);
	const next = nextText(row, now, schedulerOff);
	return (
		<div
			className={cn(
				"grid grid-cols-[16rem_1fr_7rem] border-b last:border-b-0",
				!schedule.enabled && "text-muted-foreground",
			)}
		>
			<div className="flex min-w-0 flex-col gap-1 px-4 py-3">
				<div className="flex items-center gap-2">
					<StartIcon
						schedule={schedule}
						className="shrink-0 text-muted-foreground"
					/>
					<span className="min-w-0 flex-1 truncate font-medium font-mono text-sm">
						{row.name}
					</span>
					<OnSwitch row={row} />
					<ScheduleMenu row={row} />
				</div>
				<span className="truncate text-muted-foreground text-xs">
					{whenSentence(schedule)}
				</span>
				<span className="text-xs">
					{next.main}
					{next.sub ? (
						<span className="text-muted-foreground"> · {next.sub}</span>
					) : null}
				</span>
				<ErrorLines row={row} />
			</div>

			<div className="relative min-h-16 border-x bg-muted/20">
				{ticks.map((at) => (
					<span
						key={at}
						className="absolute top-0 bottom-0 w-px bg-border"
						style={{ left: pos(at) }}
					/>
				))}
				<span
					className="absolute top-0 bottom-0 z-10 w-px bg-primary"
					style={{ left: pos(now) }}
				/>
				{coming.map((at) => {
					const stop = row.stopsAfter(at);
					return (
						<Tooltip key={at}>
							<TooltipTrigger
								render={
									<span
										className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm border border-foreground/40 border-dashed"
										style={{
											left: pos(at),
											width: stop ? width(at, stop) : "6px",
										}}
									/>
								}
							/>
							<TooltipContent>
								Starts {formatDateTime(at)}
								{stop ? `, stops ${formatTime(stop)}` : ""}
							</TooltipContent>
						</Tooltip>
					);
				})}
				{past.map((run) => (
					<Tooltip key={run.id}>
						<TooltipTrigger
							render={
								<Link
									to="/runs/$runId"
									params={{ runId: run.id }}
									className={cn(
										"absolute top-1/2 h-4 -translate-y-1/2 rounded-sm opacity-80 hover:opacity-100",
										BAR[run.status],
									)}
									style={{
										left: pos(run.createdAt),
										width: width(run.createdAt, run.endedAt ?? now),
									}}
								/>
							}
						/>
						<TooltipContent>
							{runStatusLabel(run.status)}, started{" "}
							{formatDateTime(run.createdAt)}
							{run.endedAt
								? `, took ${formatDuration(run.endedAt - run.createdAt)}`
								: ""}
						</TooltipContent>
					</Tooltip>
				))}
			</div>

			<div className="flex items-center justify-end px-4 py-3">
				<FinishedShare row={row} />
			</div>
		</div>
	);
}
