import { type ScheduleLastRuns, waitedText } from "@nightshift/client";
import { describeCron, type Schedule } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { Switch } from "@nightshift/ui/components/switch";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
	CalendarClockIcon,
	MoreHorizontalIcon,
	PencilIcon,
	RadioIcon,
	Trash2Icon,
	WebhookIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { type Machine, MachineBadge } from "@/features/devices";
import { RunStatusIcon } from "@/features/runs";
import type {
	ScheduleIssue,
	ScheduleResult,
	ScheduleSummary,
} from "@/shared/api";
import {
	dayWord,
	formatDateTime,
	formatDayTime,
	formatTime,
} from "@/shared/format";
import { LastDelivery } from "./webhook-deliveries";

/** What a schedule starts, for its name: its flow, else its signal. */
export function nameOf(schedule: Schedule): string {
	return schedule.flow ?? schedule.signal?.name ?? schedule.id;
}

/** When it starts, in words: its cron line, or a webhook. */
export function whenText(schedule: Schedule): string {
	if (schedule.webhook) return "When a webhook arrives";
	if (!schedule.cron) return "Never";
	const text = describeCron(schedule.cron);
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * One schedule on the Schedules page. It answers, in order: what it
 * starts, when, when next, how its last runs went, and where they run.
 * The switch pauses it. Edit, the webhook and Remove sit in the menu.
 */
export function ScheduleCard({
	projectId,
	schedule,
	description,
	lastRuns,
	needs,
	now,
	schedulerOff,
	busy,
	onToggle,
	onEdit,
	onDelete,
	onWebhook,
}: {
	projectId: string;
	schedule: ScheduleSummary;
	/** The description of the flow it starts. */
	description: string | null;
	lastRuns: ScheduleLastRuns;
	/** The computers its run needs: the one it runs on first. */
	needs: Machine[];
	now: number;
	/** Schedules are turned off in Settings: nothing starts. */
	schedulerOff: boolean;
	busy: boolean;
	onToggle: (enabled: boolean) => void;
	onEdit: () => void;
	onDelete: () => void;
	/** Shows a webhook schedule's address, secret and latest webhooks. */
	onWebhook: () => void;
}) {
	const name = nameOf(schedule);
	const errors = schedule.issues.filter((issue) => issue.severity === "error");
	const StartIcon = schedule.webhook ? WebhookIcon : CalendarClockIcon;
	return (
		<Card size="sm" className={cn(!schedule.enabled && "opacity-60")}>
			<CardHeader>
				<CardTitle className="flex min-w-0 items-center gap-2">
					{schedule.flow ? (
						<Link
							to="/projects/$projectId/flows/$name"
							params={{ projectId, name: schedule.flow }}
							className="truncate font-mono underline-offset-4 hover:underline"
						>
							{name}
						</Link>
					) : (
						<span className="flex min-w-0 items-center gap-1.5 font-mono">
							<RadioIcon className="size-4 shrink-0" aria-hidden="true" />
							<span className="truncate">{name}</span>
						</span>
					)}
					{errors.length > 0 ? (
						<Badge variant="destructive">
							{errors.length === 1 ? "1 problem" : `${errors.length} problems`}
						</Badge>
					) : null}
				</CardTitle>
				<CardDescription className="line-clamp-1">
					{schedule.signal ? (
						<>
							Wakes the runs that wait for{" "}
							<span className="font-mono">{schedule.signal.name}</span>
						</>
					) : !schedule.flow && schedule.scorePullRequests ? (
						"Scores runs by what became of their pull requests"
					) : (
						(description ?? "No description")
					)}
				</CardDescription>
				<CardAction>
					<Switch
						checked={schedule.enabled}
						disabled={busy}
						aria-label={`Schedule of ${name} on`}
						onCheckedChange={(checked) => onToggle(checked === true)}
					/>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<div className="flex items-start gap-3">
					<div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
						<StartIcon className="size-4" aria-hidden="true" />
					</div>
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<span className="font-medium">
							{whenText(schedule)}
							{schedule.stopAt ? `, stops ${schedule.stopAt}` : ""}
						</span>
						<span className="truncate font-mono text-muted-foreground text-xs">
							{schedule.webhook
								? (schedule.webhook.when ?? "Every webhook")
								: schedule.cron}
						</span>
					</div>
					<NextStart
						schedule={schedule}
						now={now}
						schedulerOff={schedulerOff}
					/>
				</div>
				<LastRuns lastRuns={lastRuns} />
				<LastStart schedule={schedule} />
				{needs.length > 0 ? (
					<Part label="Runs on">
						<RunsOn machines={needs} />
					</Part>
				) : null}
				{errors.length > 0 ? <IssueLines issues={errors} /> : null}
			</CardContent>
			<CardFooter className="mt-auto gap-2 border-t">
				<InputsLine inputs={schedule.inputs} baseRef={schedule.baseRef} />
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								className="ml-auto"
								aria-label={`More for the schedule of ${name}`}
							/>
						}
					>
						<MoreHorizontalIcon />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-60">
						<DropdownMenuItem onClick={onEdit}>
							<PencilIcon />
							Edit schedule
						</DropdownMenuItem>
						{schedule.webhook ? (
							<DropdownMenuItem onClick={onWebhook}>
								<WebhookIcon />
								Address and recent webhooks
							</DropdownMenuItem>
						) : null}
						<DropdownMenuSeparator />
						<DropdownMenuItem variant="destructive" onClick={onDelete}>
							<Trash2Icon />
							Remove schedule
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</CardFooter>
		</Card>
	);
}

function Part({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="font-medium text-muted-foreground text-xs">{label}</span>
			{children}
		</div>
	);
}

/** When it starts next, with a countdown, or why it does not. */
function NextStart({
	schedule,
	now,
	schedulerOff,
}: {
	schedule: ScheduleSummary;
	now: number;
	schedulerOff: boolean;
}) {
	const { nextAt } = schedule;
	const main = !schedule.enabled
		? "Paused"
		: schedulerOff
			? "Schedules paused"
			: schedule.webhook
				? "On each webhook"
				: nextAt === null
					? "No next start"
					: nextAt <= now
						? "Starts now"
						: null;
	return (
		<div className="flex shrink-0 flex-col items-end gap-0.5 text-right">
			<span className="text-muted-foreground text-xs">Next</span>
			{main !== null || nextAt === null ? (
				<span className="font-medium text-sm">{main}</span>
			) : (
				<>
					<time
						dateTime={new Date(nextAt).toISOString()}
						title={formatDateTime(nextAt)}
						className="font-medium text-sm"
					>
						{dayWord(nextAt, now)} {formatTime(nextAt)}
					</time>
					<span className="text-muted-foreground text-xs tabular-nums">
						in {waitedText(nextAt - now)}
					</span>
				</>
			)}
		</div>
	);
}

/** The status of its last runs, newest first, and how many that ended finished. */
function LastRuns({ lastRuns }: { lastRuns: ScheduleLastRuns }) {
	const { runs, ended, finished } = lastRuns;
	if (runs.length === 0) {
		return (
			<Part label="Last runs">
				<span className="text-muted-foreground text-xs">Never started</span>
			</Part>
		);
	}
	return (
		<Part label={runs.length === 1 ? "Last run" : `Last ${runs.length} runs`}>
			<div className="flex items-end justify-between gap-2">
				<div className="flex flex-wrap items-center gap-0.5">
					{runs.map((run) => (
						<Link
							key={run.id}
							to="/runs/$runId"
							params={{ runId: run.id }}
							className="rounded-sm p-0.5 hover:bg-muted"
						>
							<RunStatusIcon
								status={run.status}
								result={run.result}
								context={{ after: formatDayTime(run.createdAt) }}
								className="[&>svg]:size-3.5"
							/>
						</Link>
					))}
				</div>
				{ended > 0 ? (
					<div className="flex shrink-0 flex-col items-end gap-0.5 tabular-nums">
						<span className="font-medium text-lg leading-none">
							{Math.round((finished / ended) * 100)}%
						</span>
						<span className="text-muted-foreground text-xs">
							{finished} of {ended} finished
						</span>
					</div>
				) : null}
			</div>
		</Part>
	);
}

/**
 * What the last start did when it did not start a run: a cron time that
 * failed or was skipped, or the latest webhook.
 */
function LastStart({ schedule }: { schedule: ScheduleSummary }) {
	if (schedule.webhook) {
		const [latest] = schedule.deliveries;
		return latest ? (
			<Part label="Last webhook">
				<LastDelivery delivery={latest} />
			</Part>
		) : null;
	}
	return schedule.last && schedule.last.kind !== "fired" ? (
		<LastResult result={schedule.last} />
	) : null;
}

function LastResult({
	result,
}: {
	result: Exclude<ScheduleResult, { kind: "fired" }>;
}) {
	const when = (
		<time
			dateTime={new Date(result.at).toISOString()}
			title={formatDateTime(result.at)}
		>
			{formatDayTime(result.at)}
		</time>
	);
	if (result.kind === "failed") {
		return (
			<p className="text-destructive text-xs">
				{when}: did not start. {result.error}
			</p>
		);
	}
	return (
		<p className="text-muted-foreground text-xs">
			Skipped {formatTime(result.at)}: {result.reason}
			{result.runId ? (
				<>
					{" "}
					<Link
						to="/runs/$runId"
						params={{ runId: result.runId }}
						className="underline underline-offset-2"
					>
						Open that run
					</Link>
				</>
			) : null}
		</p>
	);
}

/**
 * The computers a run needs, each with a dot for whether it is online,
 * and a line for each one that is offline now.
 */
function RunsOn({ machines }: { machines: Machine[] }) {
	const [runsOn, ...more] = machines;
	const offline = machines.filter((machine) => machine.online === false);
	return (
		<div className="flex flex-col gap-1">
			<div className="flex flex-wrap gap-1">
				{runsOn ? (
					<MachineBadge machine={runsOn} label="The run runs here." />
				) : null}
				{more.map((machine) => (
					<MachineBadge
						key={machine.name}
						machine={machine}
						label="Steps of the flow run here."
					/>
				))}
			</div>
			{offline.map((machine) => (
				<p key={machine.name} className="text-destructive text-xs">
					{machine.name} is offline now. Its steps cannot run until it is back.
				</p>
			))}
		</div>
	);
}

/** Its input values and the branch it starts from, or "No inputs". */
function InputsLine({
	inputs,
	baseRef,
}: {
	inputs: ScheduleSummary["inputs"];
	baseRef: string | undefined;
}) {
	const parts = Object.entries(inputs).map(
		([name, value]) =>
			`${name}=${typeof value === "string" ? value : JSON.stringify(value)}`,
	);
	if (baseRef) parts.push(`from ${baseRef}`);
	return (
		<span className="min-w-0 truncate font-mono text-muted-foreground text-xs">
			{parts.length > 0 ? parts.join(" · ") : "No inputs"}
		</span>
	);
}

export function IssueLines({ issues }: { issues: readonly ScheduleIssue[] }) {
	return (
		<ul className="flex flex-col gap-0.5">
			{issues.map((issue) => (
				<li
					key={`${issue.scheduleId ?? ""}:${issue.message}`}
					className={
						issue.severity === "error"
							? "text-destructive text-xs"
							: "text-muted-foreground text-xs"
					}
				>
					{issue.message}
				</li>
			))}
		</ul>
	);
}
