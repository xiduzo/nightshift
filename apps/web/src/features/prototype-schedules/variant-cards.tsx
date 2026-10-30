/**
 * PROTOTYPE, throw away. Variant B: one card per schedule, like the Flows
 * page. The card leads with when it starts and the countdown to the next
 * start, then its last runs. Paused ones sink to the end, dimmed.
 */

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
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { SignalIcon } from "lucide-react";
import {
	ErrorLines,
	FinishedShare,
	inputsLine,
	nextText,
	OnSwitch,
	RunStrip,
	RunsOn,
	ScheduleMenu,
	StartIcon,
	whenSentence,
} from "./schedule-parts";
import type { ScheduleRow } from "./schedules-data";
import type { VariantProps } from "./schedules-prototype";

export function VariantCards({
	projectId,
	rows,
	now,
	schedulerOff,
}: VariantProps) {
	const sorted = [...rows].sort(
		(a, b) =>
			Number(b.schedule.enabled) - Number(a.schedule.enabled) ||
			(a.schedule.nextAt ?? Number.POSITIVE_INFINITY) -
				(b.schedule.nextAt ?? Number.POSITIVE_INFINITY),
	);
	return (
		<div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
			{sorted.map((row) => (
				<ScheduleCard
					key={row.schedule.id}
					projectId={projectId}
					row={row}
					now={now}
					schedulerOff={schedulerOff}
				/>
			))}
		</div>
	);
}

function ScheduleCard({
	projectId,
	row,
	now,
	schedulerOff,
}: {
	projectId: string;
	row: ScheduleRow;
	now: number;
	schedulerOff: boolean;
}) {
	const { schedule } = row;
	const next = nextText(row, now, schedulerOff);
	const inputs = inputsLine(schedule);
	return (
		<Card size="sm" className={cn(!schedule.enabled && "opacity-60")}>
			<CardHeader>
				<CardTitle className="flex min-w-0 items-center gap-2">
					{schedule.flow ? (
						<Link
							to="/projects/$projectId/flows/$name"
							params={{ projectId, name: schedule.flow }}
							className="truncate font-mono hover:underline"
						>
							{row.name}
						</Link>
					) : (
						<span className="flex items-center gap-1.5 truncate font-mono">
							<SignalIcon className="size-4" aria-hidden="true" />
							{row.name}
						</span>
					)}
					{row.errors.length > 0 ? (
						<Badge variant="destructive">
							{row.errors.length === 1
								? "1 problem"
								: `${row.errors.length} problems`}
						</Badge>
					) : null}
				</CardTitle>
				<CardDescription className="line-clamp-1">
					{row.description ?? "No description"}
				</CardDescription>
				<CardAction>
					<OnSwitch row={row} />
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex items-start gap-3">
					<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
						<StartIcon schedule={schedule} />
					</div>
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="font-medium">{whenSentence(schedule)}</span>
						<span className="font-mono text-muted-foreground text-xs">
							{schedule.webhook
								? (schedule.webhook.when ?? "Every webhook")
								: schedule.cron}
						</span>
					</div>
					<div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
						<span className="text-muted-foreground text-xs">Next</span>
						<span className="font-medium text-sm">{next.main}</span>
						{next.sub ? (
							<span className="text-muted-foreground text-xs tabular-nums">
								{next.sub}
							</span>
						) : null}
					</div>
				</div>
				<div className="flex flex-col gap-1.5">
					<span className="font-medium text-muted-foreground text-xs">
						{row.runs.length === 0
							? "Last runs"
							: `Last ${Math.min(10, row.runs.length)} runs`}
					</span>
					<div className="flex items-end justify-between gap-2">
						<RunStrip row={row} />
						<FinishedShare row={row} />
					</div>
				</div>
				{row.needs.length > 0 ? (
					<div className="flex flex-col gap-1.5">
						<span className="font-medium text-muted-foreground text-xs">
							Runs on
						</span>
						<RunsOn row={row} />
					</div>
				) : null}
				<ErrorLines row={row} />
			</CardContent>
			<CardFooter className="mt-auto gap-2 border-t">
				<span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs">
					{inputs ?? "No inputs"}
				</span>
				<ScheduleMenu row={row} />
			</CardFooter>
		</Card>
	);
}
