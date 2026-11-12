import {
	canStart,
	type FlowOverview,
	type FlowStart,
} from "@nightshift/client";
import { describeCron } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
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
	HandIcon,
	type LucideIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlayIcon,
	RadioIcon,
	Trash2Icon,
	WebhookIcon,
	WorkflowIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { neededMachines, useSpaceMachines } from "@/features/devices";
import { ReportPreview, RunBars, reportLink } from "@/features/runs/flows-port";
import { formatDayTime, formatRelative, useNow } from "@/shared/format";
import { LocalTime } from "@/shared/time";

/**
 * One flow on the Flows page: what it is, what starts it, how its last
 * runs went, and the start of its latest report. A line says what blocks
 * it: errors in the flow, or a computer it needs that is offline. Run,
 * Edit and Delete are in the menu.
 */
export function FlowCard({
	projectId,
	overview,
	onRun,
	onSchedules,
	onDelete,
}: {
	projectId: string;
	overview: FlowOverview;
	onRun: () => void;
	/** Opens the flow's schedules. */
	onSchedules: () => void;
	onDelete: () => void;
}) {
	const { flow } = overview;
	return (
		<Card className="[--card-spacing:--spacing(5)]">
			<CardHeader>
				<CardTitle className="min-w-0 truncate">
					<Link
						to="/projects/$projectId/flows/$name"
						params={{ projectId, name: flow.name }}
						className="underline-offset-4 hover:underline"
					>
						{flow.name}
					</Link>
				</CardTitle>
				<CardDescription className="line-clamp-2">
					{flow.description ?? "No description"}
				</CardDescription>
				<CardAction>
					<FlowMenu
						projectId={projectId}
						overview={overview}
						onRun={onRun}
						onSchedules={onSchedules}
						onDelete={onDelete}
					/>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-3.5">
				<Starts starts={overview.starts} onSchedules={onSchedules} />
				<LastRuns overview={overview} />
				{overview.report ? <LatestReport report={overview.report} /> : null}
				<Blockers overview={overview} />
			</CardContent>
		</Card>
	);
}

/** One fact of the card: a small icon and a short text. */
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

const START_ICON: Record<FlowStart["kind"], LucideIcon> = {
	schedule: CalendarClockIcon,
	webhook: WebhookIcon,
	signal: RadioIcon,
	subflow: WorkflowIcon,
};

/** A short name for a way it starts: "Every day at 22:00", "Webhook", "Wakes on ci-done", "In night". */
function startText(start: FlowStart): string {
	if (start.kind === "subflow") return `In ${start.caller}`;
	if (start.kind === "webhook") return "Webhook";
	if (start.kind === "signal") {
		return `Wakes on ${start.schedule.signal?.name ?? "a webhook"}`;
	}
	if (!start.schedule.cron) return "Never";
	const text = describeCron(start.schedule.cron);
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What a start's tooltip says: when it starts next, or who runs it. */
function startHint(start: FlowStart): string {
	if (start.kind === "subflow") {
		return `A Subflow node in ${start.caller} runs this flow.`;
	}
	if (!start.schedule.enabled) return "This schedule is paused.";
	if (start.kind === "webhook") return "Starts when a webhook arrives.";
	if (start.kind === "signal") {
		return "A webhook wakes the runs that wait for this signal.";
	}
	const { nextAt } = start.schedule;
	return nextAt === null
		? "No next start."
		: `Starts next on ${formatDayTime(nextAt)}.`;
}

/**
 * What starts it: a schedule, a webhook, another flow, or only you. Each
 * one opens the flow's schedules, where you add, change or pause them.
 */
function Starts({
	starts,
	onSchedules,
}: {
	starts: FlowOverview["starts"];
	onSchedules: () => void;
}) {
	const opener = (label: string) => (
		<Button
			variant="link"
			size="xs"
			className="h-auto p-0 text-foreground"
			onClick={onSchedules}
			aria-label={label}
		/>
	);
	if (starts.length === 0) {
		return (
			<span className="inline-flex">
				<Tooltip>
					<TooltipTrigger render={opener("By hand. Add a schedule.")}>
						<Fact icon={HandIcon}>By hand</Fact>
					</TooltipTrigger>
					<TooltipContent>
						You start it. Add a schedule to run it on its own.
					</TooltipContent>
				</Tooltip>
			</span>
		);
	}
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
			{starts.map((start, index) => {
				const paused = start.kind !== "subflow" && !start.schedule.enabled;
				const label = `${startText(start)}${paused ? " (paused)" : ""}`;
				return (
					<Tooltip key={index}>
						<TooltipTrigger
							render={
								start.kind === "subflow" ? (
									<span className="inline-flex" />
								) : (
									opener(label)
								)
							}
							aria-label={label}
						>
							<Fact
								icon={START_ICON[start.kind]}
								className={cn(
									start.kind === "subflow" && "font-mono",
									paused && "text-muted-foreground line-through",
								)}
							>
								{startText(start)}
							</Fact>
						</TooltipTrigger>
						<TooltipContent>{startHint(start)}</TooltipContent>
					</Tooltip>
				);
			})}
		</div>
	);
}

/** Its last runs as bars, oldest on the left, so the newest sits at the end. */
function LastRuns({ overview }: { overview: FlowOverview }) {
	const { lastRuns } = overview;
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-muted-foreground text-xs">
				{lastRuns.length === 0 ? "Never run" : "Last runs"}
			</span>
			{lastRuns.length > 0 ? (
				<RunBars
					runs={[...lastRuns].reverse().map((run) => ({
						runId: run.runId,
						status: run.status,
						hint: formatDayTime(run.startedAt),
					}))}
				/>
			) : (
				<div className="h-4" />
			)}
		</div>
	);
}

/**
 * The newest report of its runs, of any day: when its run ended, and its
 * first lines without marks. The label opens it on the run's page.
 */
function LatestReport({
	report,
}: {
	report: NonNullable<FlowOverview["report"]>;
}) {
	const now = useNow();
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<span className="flex items-center gap-1.5 text-xs">
				<Button
					variant="link"
					size="xs"
					className="h-auto p-0 text-foreground"
					nativeButton={false}
					render={<Link {...reportLink(report)} />}
				>
					Latest report
				</Button>
				<LocalTime at={report.endedAt} className="text-muted-foreground">
					{formatRelative(report.endedAt, now)}
				</LocalTime>
			</span>
			<ReportPreview text={report.excerpt} plain />
		</div>
	);
}

/** Why a run cannot start or finish now: errors in the flow, or an offline computer. */
function Blockers({ overview }: { overview: FlowOverview }) {
	const { flow, problem } = overview;
	const machines = useSpaceMachines();
	// The run's own computer is the one you start it on: only what the flow names.
	const offline = (
		machines ? neededMachines(machines, false, flow.devices) : []
	).filter((machine) => machine.online === false);
	const lines = [
		problem?.kind === "does-not-load"
			? "This flow does not load. Open it to see why."
			: problem?.kind === "errors"
				? `${problem.count} ${problem.count === 1 ? "error" : "errors"} in this flow. Fix them in the editor.`
				: null,
		...offline.map(
			(machine) =>
				`${machine.name} is offline. Its steps cannot run until it is back.`,
		),
	].filter((line): line is string => line !== null);
	if (lines.length === 0) return null;
	return (
		<ul className="flex flex-col gap-0.5">
			{lines.map((line) => (
				<li
					key={line}
					className="flex items-start gap-1.5 text-destructive text-xs"
				>
					<CircleAlertIcon
						className="mt-px size-3.5 shrink-0"
						aria-hidden="true"
					/>
					{line}
				</li>
			))}
		</ul>
	);
}

/** Run, Edit, its schedules, and Delete. */
function FlowMenu({
	projectId,
	overview,
	onRun,
	onSchedules,
	onDelete,
}: {
	projectId: string;
	overview: FlowOverview;
	onRun: () => void;
	onSchedules: () => void;
	onDelete: () => void;
}) {
	const { flow } = overview;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`More for ${flow.name}`}
					/>
				}
			>
				<MoreHorizontalIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem disabled={!canStart(flow)} onClick={onRun}>
					<PlayIcon />
					Run
				</DropdownMenuItem>
				<DropdownMenuItem
					render={
						<Link
							to="/projects/$projectId/flows/$name"
							params={{ projectId, name: flow.name }}
						/>
					}
				>
					<PencilIcon />
					Edit
				</DropdownMenuItem>
				<DropdownMenuItem onClick={onSchedules}>
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
	);
}
