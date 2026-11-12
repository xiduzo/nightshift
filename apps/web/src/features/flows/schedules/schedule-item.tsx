import {
	isPausedTonight,
	type ScheduleLastRuns,
	scheduleWhen,
} from "@nightshift/client";
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
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemFooter,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
	AlarmClockOffIcon,
	CalendarClockIcon,
	type LucideIcon,
	MoreHorizontalIcon,
	PauseIcon,
	PencilIcon,
	PlayIcon,
	TextCursorInputIcon,
	Trash2Icon,
	WebhookIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { Machine } from "@/features/devices";
import { RunBars } from "@/features/runs/flows-port";
import type {
	ScheduleIssue,
	ScheduleResult,
	ScheduleSummary,
} from "@/shared/api";
import { formatDayTime, formatTime, hoverTime } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { LastDelivery } from "./webhook-deliveries";

/**
 * One schedule of a flow, as an Item. The title says when it starts,
 * with a Paused badge when it is off, and its menu. The facts say what
 * it starts with. The bars show its last runs. Lines say what went
 * wrong: a skipped start, an offline computer, a problem.
 */
export function ScheduleItem({
	schedule,
	description,
	lastRuns,
	needs,
	now,
	busy,
	onToggle,
	onEdit,
	onDelete,
	onWebhook,
}: {
	schedule: ScheduleSummary;
	/** What it does, when the flow around it does not say so already. */
	description?: ReactNode;
	lastRuns: ScheduleLastRuns;
	/** The computers its run needs: the one it runs on first. */
	needs: Machine[];
	now: number;
	busy: boolean;
	onToggle: (enabled: boolean) => void;
	onEdit: () => void;
	onDelete: () => void;
	/** Shows a webhook schedule's address, secret and latest webhooks. */
	onWebhook: () => void;
}) {
	const when = `${scheduleWhen(schedule)}${schedule.stopAt ? `, stops ${schedule.stopAt}` : ""}`;
	const runsOn = needs[0]?.name ?? null;
	const errors = schedule.issues.filter((issue) => issue.severity === "error");
	const what = schedule.signal ? (
		<>
			Wakes the runs that wait for{" "}
			<span className="font-mono">{schedule.signal.name}</span>
		</>
	) : !schedule.flow && schedule.scorePullRequests ? (
		"Scores runs by what became of their pull requests"
	) : (
		description
	);
	const Icon = schedule.webhook ? WebhookIcon : CalendarClockIcon;
	return (
		<Item variant="outline" className="items-start">
			<ItemMedia
				variant="icon"
				className={cn(
					"mt-0.5 self-start",
					!schedule.enabled && "text-muted-foreground",
				)}
			>
				<Icon aria-hidden="true" />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle className="max-w-full">
					<Tooltip>
						<TooltipTrigger
							render={
								<span
									className={cn(
										"truncate",
										!schedule.enabled && "text-muted-foreground",
									)}
								/>
							}
						>
							{when}
						</TooltipTrigger>
						<TooltipContent className="font-mono">
							{schedule.webhook
								? (schedule.webhook.when ?? "Every webhook")
								: schedule.cron}
						</TooltipContent>
					</Tooltip>
				</ItemTitle>
				{what ? <ItemDescription>{what}</ItemDescription> : null}
			</ItemContent>
			<ItemActions className="gap-1.5">
				{schedule.enabled ? null : (
					<Badge variant="outline" className="text-muted-foreground">
						<PauseIcon aria-hidden="true" />
						Paused
					</Badge>
				)}
				<ScheduleMenu
					name={when}
					webhook={schedule.webhook !== undefined}
					enabled={schedule.enabled}
					busy={busy}
					onToggle={onToggle}
					onEdit={onEdit}
					onWebhook={onWebhook}
					onDelete={onDelete}
				/>
			</ItemActions>
			<ItemFooter className="flex-col items-stretch justify-start gap-3 pl-7.5">
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 empty:hidden">
					<NoNextStart schedule={schedule} now={now} />
					<InputsFact inputs={schedule.inputs} baseRef={schedule.baseRef} />
				</div>
				<LastRuns
					lastRuns={lastRuns}
					zone={schedule.timeZone}
					device={runsOn}
				/>
				<LastStart schedule={schedule} device={runsOn} />
				<OfflineLines machines={needs} />
				{errors.length > 0 ? <IssueLines issues={errors} /> : null}
			</ItemFooter>
		</Item>
	);
}

/** One fact of the schedule: a small icon and a short text. */
function Fact({
	icon: Icon,
	className,
	children,
}: {
	icon: LucideIcon;
	className?: string;
	children: ReactNode;
}) {
	return (
		<span className={cn("inline-flex items-center gap-1.5 text-xs", className)}>
			<Icon
				className="size-3.5 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
			{children}
		</span>
	);
}

function Part({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-muted-foreground text-xs">{label}</span>
			{children}
		</div>
	);
}

/** Pause or turn on, Edit, the webhook, and Remove. */
function ScheduleMenu({
	name,
	webhook,
	enabled,
	busy,
	onToggle,
	onEdit,
	onWebhook,
	onDelete,
}: {
	name: string;
	webhook: boolean;
	enabled: boolean;
	/** A save is under way: the schedule cannot change now. */
	busy: boolean;
	onToggle: (enabled: boolean) => void;
	onEdit: () => void;
	onWebhook: () => void;
	onDelete: () => void;
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`More for this schedule: ${name}`}
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-60">
				<DropdownMenuItem disabled={busy} onClick={() => onToggle(!enabled)}>
					{enabled ? <PauseIcon /> : <PlayIcon />}
					{enabled ? "Pause schedule" : "Turn on schedule"}
				</DropdownMenuItem>
				<DropdownMenuItem onClick={onEdit}>
					<PencilIcon />
					Edit schedule
				</DropdownMenuItem>
				{webhook ? (
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
	);
}

/**
 * Why a time it shows will not start a run: paused for tonight, or no
 * time is left. A normal next start is left out: the time above says it.
 * "Schedules are paused" is a notice of the whole page.
 */
function NoNextStart({
	schedule,
	now,
}: {
	schedule: ScheduleSummary;
	now: number;
}) {
	if (!schedule.enabled || schedule.webhook) return null;
	if (isPausedTonight(schedule, now)) {
		return <Fact icon={AlarmClockOffIcon}>Paused tonight</Fact>;
	}
	if (schedule.nextAt === null) {
		return <Fact icon={AlarmClockOffIcon}>No next start</Fact>;
	}
	return null;
}

/** Its last runs as bars, oldest on the left, so the newest sits at the end. */
function LastRuns({
	lastRuns,
	zone,
	device,
}: {
	lastRuns: ScheduleLastRuns;
	zone?: string;
	device?: string | null;
}) {
	const { runs } = lastRuns;
	return (
		<Part label={runs.length === 0 ? "Never started" : "Last runs"}>
			{runs.length > 0 ? (
				<RunBars
					runs={[...runs].reverse().map((run) => ({
						runId: run.id,
						status: run.status,
						result: run.result,
						hint: hoverTime(run.createdAt, { zone, device }),
					}))}
				/>
			) : (
				<div className="h-4" />
			)}
		</Part>
	);
}

/**
 * What the last start did when it did not start a run: a cron time that
 * failed or was skipped, or a webhook that was filtered out or refused.
 */
function LastStart({
	schedule,
	device,
}: {
	schedule: ScheduleSummary;
	device: string | null;
}) {
	if (schedule.webhook) {
		const [latest] = schedule.deliveries;
		// An accepted webhook shows as a bar. Only one that started nothing gets a line.
		return latest && latest.result !== "accepted" ? (
			<Part label="Last webhook">
				<LastDelivery
					delivery={latest}
					zone={schedule.timeZone}
					device={device}
				/>
			</Part>
		) : null;
	}
	return schedule.last && schedule.last.kind !== "fired" ? (
		<LastResult
			result={schedule.last}
			zone={schedule.timeZone}
			device={device}
		/>
	) : null;
}

function LastResult({
	result,
	zone,
	device,
}: {
	result: Exclude<ScheduleResult, { kind: "fired" }>;
	zone?: string;
	device?: string | null;
}) {
	const when = (
		<LocalTime at={result.at} zone={zone} device={device}>
			{formatDayTime(result.at)}
		</LocalTime>
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
			Skipped{" "}
			<LocalTime at={result.at} zone={zone} device={device}>
				{formatTime(result.at)}
			</LocalTime>
			: {result.reason}
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

/** A line for each computer the run needs that is offline now. */
function OfflineLines({ machines }: { machines: Machine[] }) {
	const offline = machines.filter((machine) => machine.online === false);
	if (offline.length === 0) return null;
	return (
		<div className="flex flex-col gap-0.5">
			{offline.map((machine) => (
				<p key={machine.name} className="text-destructive text-xs">
					{machine.name} is offline now. Its steps cannot run until it is back.
				</p>
			))}
		</div>
	);
}

/** Its input values and the branch it starts from, when it has any. */
function InputsFact({
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
	if (parts.length === 0) return null;
	return (
		<Fact icon={TextCursorInputIcon} className="min-w-0 max-w-full font-mono">
			<span className="sr-only">Inputs: </span>
			<span className="truncate">{parts.join(" · ")}</span>
		</Fact>
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
