/** PROTOTYPE, throw away. Small pieces the Flows page variants share. */

import { canStart, waitedText } from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { Link } from "@tanstack/react-router";
import {
	CalendarClockIcon,
	CircleAlertIcon,
	FileWarningIcon,
	HandIcon,
	type LucideIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlayIcon,
	Trash2Icon,
	WebhookIcon,
	WorkflowIcon,
} from "lucide-react";
import { RunStatusIcon } from "@/features/runs";
import type { FlowListItem } from "@/shared/api";
import {
	dayWord,
	formatDateTime,
	formatRelative,
	formatTime,
} from "@/shared/format";
import { type FlowRow, type StartKind, scheduleText } from "./flows-data";

export const START_ICON: Record<StartKind, LucideIcon> = {
	schedule: CalendarClockIcon,
	webhook: WebhookIcon,
	subflow: WorkflowIcon,
	manual: HandIcon,
};

/** Why the flow cannot start now, or null. */
export function runBlockedBy(flow: FlowListItem): string | null {
	if (canStart(flow)) return null;
	return flow.nodeCount === null
		? "This flow does not load. Open it to see why."
		: "Fix the errors in the editor first.";
}

/** The status of the last runs, newest first, each a link to its run. */
export function LastRunsStrip({
	row,
	now,
	max = 10,
	withWhen = true,
}: {
	row: FlowRow;
	now: number;
	max?: number;
	withWhen?: boolean;
}) {
	const health = row.health;
	if (!health?.last) {
		return <span className="text-muted-foreground text-xs">Never run</span>;
	}
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center gap-0.5">
				{health.lastRuns.slice(0, max).map((run) => (
					<Link
						key={run.runId}
						to="/runs/$runId"
						params={{ runId: run.runId }}
						onClick={(event) => event.stopPropagation()}
						className="relative z-10 rounded-sm p-0.5 hover:bg-muted"
					>
						<RunStatusIcon status={run.status} className="[&>svg]:size-3.5" />
					</Link>
				))}
			</div>
			{withWhen ? (
				<time
					dateTime={new Date(health.last.startedAt).toISOString()}
					title={formatDateTime(health.last.startedAt)}
					className="text-muted-foreground text-xs"
				>
					Last run {formatRelative(health.last.startedAt, now)}
				</time>
			) : null}
		</div>
	);
}

/** How the flow starts, and when it starts next. */
export function StartsCell({ row, now }: { row: FlowRow; now: number }) {
	const Icon = START_ICON[row.start];
	const main =
		row.start === "subflow"
			? `Run by ${row.flow.callers.join(", ")}`
			: row.next
				? scheduleText(row.next)
				: "When you start it";
	return (
		<div className="flex min-w-0 items-start gap-2">
			<Icon
				className="mt-0.5 size-4 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="truncate">{main}</span>
				{row.next ? <NextStart schedule={row.next} now={now} /> : null}
				{row.schedules.length > 1 ? (
					<span className="text-muted-foreground text-xs">
						{row.schedules.length} schedules
					</span>
				) : null}
				{row.schedules.length > 0 &&
				row.schedules.every((schedule) => !schedule.enabled) ? (
					<span className="text-muted-foreground text-xs">
						Its schedule is paused
					</span>
				) : null}
			</div>
		</div>
	);
}

export function NextStart({
	schedule,
	now,
}: {
	schedule: FlowRow["schedules"][number];
	now: number;
}) {
	if (schedule.webhook) return null;
	if (schedule.nextAt === null) {
		return <span className="text-muted-foreground text-xs">No next start</span>;
	}
	return (
		<span className="text-muted-foreground text-xs tabular-nums">
			Next {dayWord(schedule.nextAt, now).toLowerCase()},{" "}
			{formatTime(schedule.nextAt)} (in {waitedText(schedule.nextAt - now)})
		</span>
	);
}

/** How many of the ended runs finished, and how many runs there were. */
export function FinishedCell({ row }: { row: FlowRow }) {
	const health = row.health;
	if (!health || health.runs === 0) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<div className="flex flex-col gap-0.5 tabular-nums">
			<span>{health.rate === null ? "—" : `${health.rate}%`}</span>
			<span className="text-muted-foreground text-xs">
				{health.runs} {health.runs === 1 ? "run" : "runs"}
			</span>
		</div>
	);
}

export function ProblemBadge({ problem }: { problem: FlowRow["problem"] }) {
	if (!problem) return null;
	const Icon =
		problem.text === "Does not load" ? FileWarningIcon : CircleAlertIcon;
	return (
		<Badge variant={problem.kind === "broken" ? "destructive" : "outline"}>
			<Icon aria-hidden="true" />
			{problem.text}
		</Badge>
	);
}

/** Run, and a menu to edit or delete. */
export function FlowActions({
	projectId,
	row,
	onRun,
	onDelete,
	runLabel = true,
}: {
	projectId: string;
	row: FlowRow;
	onRun: () => void;
	onDelete: () => void;
	runLabel?: boolean;
}) {
	const blocked = runBlockedBy(row.flow);
	return (
		<div className="relative z-10 flex items-center gap-1">
			<Tooltip>
				<TooltipTrigger render={<span className="inline-flex" />}>
					<Button
						size={runLabel ? "sm" : "icon-sm"}
						variant="outline"
						disabled={blocked !== null}
						aria-label={`Run ${row.name}`}
						onClick={(event) => {
							event.stopPropagation();
							onRun();
						}}
					>
						<PlayIcon data-icon={runLabel ? "inline-start" : undefined} />
						{runLabel ? "Run" : null}
					</Button>
				</TooltipTrigger>
				<TooltipContent>{blocked ?? "Start a run of this flow"}</TooltipContent>
			</Tooltip>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={`More for ${row.name}`}
							onClick={(event) => event.stopPropagation()}
						/>
					}
				>
					<MoreHorizontalIcon />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						render={
							<Link
								to="/projects/$projectId/flows/$name"
								params={{ projectId, name: row.name }}
							/>
						}
					>
						<PencilIcon />
						Edit
					</DropdownMenuItem>
					<DropdownMenuItem
						render={
							<Link
								to="/projects/$projectId/schedules"
								params={{ projectId }}
							/>
						}
					>
						<CalendarClockIcon />
						Schedules
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem variant="destructive" onClick={onDelete}>
						<Trash2Icon />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
