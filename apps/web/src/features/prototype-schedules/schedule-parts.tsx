/** PROTOTYPE, throw away: small pieces the Schedules page variants share. */

import { waitedText } from "@nightshift/client";
import { describeCron } from "@nightshift/flows";
import { Alert, AlertDescription } from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { Switch } from "@nightshift/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
	CalendarClockIcon,
	CircleAlertIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PowerOffIcon,
	Trash2Icon,
	WebhookIcon,
} from "lucide-react";
import { toast } from "sonner";
import { MachineBadge } from "@/features/devices";
import { RunStatusIcon } from "@/features/runs";
import type { ScheduleIssue, ScheduleSummary } from "@/shared/api";
import { dayWord, formatDateTime, formatTime } from "@/shared/format";
import { finishedShare, type ScheduleRow } from "./schedules-data";

/** The prototype saves nothing: the schedules are real. */
export function stub(what: string) {
	toast.info(`Prototype: ${what} is not saved.`);
}

/** When it starts, as a sentence: "Every day at 22:00, stops 07:00". */
export function whenSentence(schedule: ScheduleSummary): string {
	const base = schedule.webhook
		? "When a webhook arrives"
		: schedule.cron
			? describeCron(schedule.cron)
			: "Never";
	const text = base.charAt(0).toUpperCase() + base.slice(1);
	return schedule.stopAt ? `${text}, stops ${schedule.stopAt}` : text;
}

/** "today 22:00", "tomorrow 04:30", "Monday 04:30". */
export function shortNext(at: number, now: number): string {
	return `${dayWord(at, now)} ${formatTime(at)}`;
}

/** The next start in words, or why there is none. */
export function nextText(
	row: ScheduleRow,
	now: number,
	schedulerOff: boolean,
): { main: string; sub: string | null } {
	const { schedule } = row;
	if (!schedule.enabled) return { main: "Paused", sub: null };
	if (schedulerOff) return { main: "Schedules are paused", sub: null };
	if (schedule.webhook) return { main: "On each webhook", sub: null };
	if (schedule.nextAt === null) return { main: "No next start", sub: null };
	return {
		main: shortNext(schedule.nextAt, now),
		sub: `in ${waitedText(Math.max(0, schedule.nextAt - now))}`,
	};
}

export function StartIcon({
	schedule,
	className,
}: {
	schedule: ScheduleSummary;
	className?: string;
}) {
	const Icon = schedule.webhook ? WebhookIcon : CalendarClockIcon;
	return <Icon aria-hidden="true" className={cn("size-4", className)} />;
}

export function OnSwitch({ row }: { row: ScheduleRow }) {
	return (
		<Switch
			checked={row.schedule.enabled}
			aria-label={`Schedule of ${row.name} on`}
			onCheckedChange={() => stub("turning a schedule on or off")}
		/>
	);
}

/** Edit, the webhook's address, remove. */
export function ScheduleMenu({ row }: { row: ScheduleRow }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`More for ${row.name}`}
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem onClick={() => stub("editing")}>
					<PencilIcon />
					Edit schedule
				</DropdownMenuItem>
				{row.schedule.webhook ? (
					<DropdownMenuItem onClick={() => stub("the webhook dialog")}>
						<WebhookIcon />
						Address and recent webhooks
					</DropdownMenuItem>
				) : null}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					onClick={() => stub("removing")}
				>
					<Trash2Icon />
					Remove schedule
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Its last runs as status icons, newest first, each a link to the run. */
export function RunStrip({
	row,
	count = 10,
	className,
}: {
	row: ScheduleRow;
	count?: number;
	className?: string;
}) {
	const runs = row.runs.slice(0, count);
	if (runs.length === 0) {
		return <span className="text-muted-foreground text-xs">Never started</span>;
	}
	return (
		<div className={cn("flex items-center gap-0.5", className)}>
			{runs.map((run) => (
				<Tooltip key={run.id}>
					<TooltipTrigger
						render={
							<Link
								to="/runs/$runId"
								params={{ runId: run.id }}
								className="relative z-10 rounded-sm p-0.5 hover:bg-muted"
							/>
						}
					>
						<RunStatusIcon status={run.status} className="[&>svg]:size-3.5" />
					</TooltipTrigger>
					<TooltipContent>{formatDateTime(run.createdAt)}</TooltipContent>
				</Tooltip>
			))}
		</div>
	);
}

/** "80%" and "8 of 10 finished" over its last runs. */
export function FinishedShare({
	row,
	count = 10,
	inline = false,
}: {
	row: ScheduleRow;
	count?: number;
	inline?: boolean;
}) {
	const { ended, finished } = finishedShare(row.runs.slice(0, count));
	if (ended === 0) return null;
	if (inline) {
		return (
			<span className="text-muted-foreground text-xs tabular-nums">
				{finished} of {ended} finished
			</span>
		);
	}
	return (
		<div className="flex flex-col items-end gap-0.5 tabular-nums">
			<span className="font-medium text-lg leading-none">
				{Math.round((finished / ended) * 100)}%
			</span>
			<span className="text-muted-foreground text-xs">
				{finished} of {ended} finished
			</span>
		</div>
	);
}

export function RunsOn({ row }: { row: ScheduleRow }) {
	if (row.needs.length === 0) return null;
	return (
		<div className="flex flex-wrap gap-1">
			{row.needs.map((machine, index) => (
				<MachineBadge
					key={machine.name}
					machine={machine}
					label={
						index === 0 ? "The run runs here." : "Steps of the flow run here."
					}
					className="relative z-10"
				/>
			))}
		</div>
	);
}

/** Its inputs and the branch it starts from, as one mono line. */
export function inputsLine(schedule: ScheduleSummary): string | null {
	const parts = Object.entries(schedule.inputs).map(
		([name, value]) =>
			`${name}=${typeof value === "string" ? value : JSON.stringify(value)}`,
	);
	if (schedule.baseRef) parts.push(`from ${schedule.baseRef}`);
	return parts.length > 0 ? parts.join(" · ") : null;
}

/** The page's alerts: problems in the file, and schedules turned off. */
export function Notices({
	issues,
	schedulerOff,
}: {
	issues: readonly ScheduleIssue[];
	schedulerOff: boolean;
}) {
	return (
		<>
			{issues.length > 0 ? (
				<Alert>
					<CircleAlertIcon aria-hidden="true" />
					<AlertDescription>
						{issues.map((issue) => issue.message).join(" ")}
					</AlertDescription>
				</Alert>
			) : null}
			{schedulerOff ? (
				<Alert>
					<PowerOffIcon aria-hidden="true" />
					<AlertDescription>
						Schedules are paused, so no flow starts on its own. Turn them on in{" "}
						<Link to="/settings" className="underline underline-offset-4">
							Settings
						</Link>
						.
					</AlertDescription>
				</Alert>
			) : null}
		</>
	);
}

export function ErrorLines({ row }: { row: ScheduleRow }) {
	if (row.errors.length === 0) return null;
	return (
		<ul className="flex flex-col gap-0.5">
			{row.errors.map((message) => (
				<li key={message} className="text-destructive text-xs">
					{message}
				</li>
			))}
		</ul>
	);
}
