import {
	canStart,
	type FlowOverview,
	type FlowStart,
} from "@nightshift/client";
import { describeCron } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
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
	FileWarningIcon,
	HandIcon,
	type LucideIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlayIcon,
	Trash2Icon,
	UserRoundIcon,
	WebhookIcon,
	WorkflowIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import {
	MachineBadge,
	neededMachines,
	useSpaceMachines,
} from "@/features/devices";
import { RunStatusIcon } from "@/features/runs/flows-port";
import { hoverTime } from "@/shared/format";
import { NODE_TYPE } from "./canvas/node-type";

/**
 * One flow on the Flows page. It answers four questions in order: what it
 * is, what starts it besides you, what is in it, and how its last runs
 * went. Run and the menu sit in the footer. The card opens the editor.
 */
export function FlowCard({
	projectId,
	overview,
	onRun,
	onDelete,
}: {
	projectId: string;
	overview: FlowOverview;
	onRun: () => void;
	onDelete: () => void;
}) {
	const { flow } = overview;
	return (
		<Card
			size="sm"
			className="relative transition-colors hover:bg-muted/40 has-[a[data-stretched]:focus-visible]:ring-2 has-[a[data-stretched]:focus-visible]:ring-ring/50"
		>
			<CardHeader>
				<CardTitle className="flex min-w-0 items-center gap-2">
					{/* The link covers the card, so the card is one target. */}
					<Link
						to="/projects/$projectId/flows/$name"
						params={{ projectId, name: flow.name }}
						data-stretched=""
						className="truncate font-mono outline-none after:absolute after:inset-0"
					>
						{flow.name}
					</Link>
					<ProblemBadge problem={overview.problem} />
				</CardTitle>
				<CardDescription className="line-clamp-2">
					{flow.description ?? "No description"}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<Part label="Started by">
					<div className="relative z-10 flex flex-wrap gap-1">
						<StartChips starts={overview.starts} />
					</div>
				</Part>
				<Steps overview={overview} />
				<LastRuns overview={overview} />
			</CardContent>
			<CardFooter className="mt-auto gap-2 border-t">
				<span className="min-w-0 truncate font-mono text-muted-foreground text-xs">
					{flow.inputs.length > 0 ? (
						<>
							<span className="sr-only">Inputs: </span>
							{flow.inputs
								.map((input) => `${input.name}${input.required ? "" : "?"}`)
								.join(", ")}
						</>
					) : (
						"No inputs"
					)}
				</span>
				<FlowActions
					projectId={projectId}
					overview={overview}
					onRun={onRun}
					onDelete={onDelete}
				/>
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

const START_ICON: Record<FlowStart["kind"], LucideIcon> = {
	schedule: CalendarClockIcon,
	webhook: WebhookIcon,
	subflow: WorkflowIcon,
};

/** A short name for a way it starts: "Daily 22:00", "Webhook", "In night". */
function startText(start: FlowStart): string {
	if (start.kind === "subflow") return `In ${start.caller}`;
	if (start.kind === "webhook") return "Webhook";
	if (!start.schedule.cron) return "Never";
	const text = describeCron(start.schedule.cron)
		.replace(/^every day at /, "daily ")
		.replace(/^weekdays at /, "weekdays ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What the chip's tooltip says: the whole schedule, or who runs it. */
function startHint(start: FlowStart): string {
	if (start.kind === "subflow") {
		return `A Subflow node in ${start.caller} runs this flow.`;
	}
	if (!start.schedule.enabled) return "This schedule is paused.";
	if (start.kind === "webhook") return "Starts when a webhook arrives.";
	const { nextAt } = start.schedule;
	return nextAt === null
		? "No next start."
		: `Starts next on ${hoverTime(nextAt, {
				zone: start.schedule.timeZone,
				device: start.schedule.device,
			})}.`;
}

/** Every way the flow starts besides you, one chip each. */
function StartChips({ starts }: { starts: FlowStart[] }) {
	if (starts.length === 0) {
		return (
			<Badge variant="outline" className="font-normal text-muted-foreground">
				<HandIcon aria-hidden="true" />
				Only by hand
			</Badge>
		);
	}
	return starts.map((start, index) => {
		const Icon = START_ICON[start.kind];
		const paused = start.kind !== "subflow" && !start.schedule.enabled;
		return (
			<Tooltip key={index}>
				<TooltipTrigger
					render={
						<Badge
							variant={paused ? "outline" : "secondary"}
							className={cn(
								"font-normal",
								start.kind === "subflow" && "font-mono",
								paused && "text-muted-foreground line-through",
							)}
						/>
					}
				>
					<Icon aria-hidden="true" />
					{startText(start)}
					{paused ? <span className="sr-only"> (paused)</span> : null}
				</TooltipTrigger>
				<TooltipContent>{startHint(start)}</TooltipContent>
			</Tooltip>
		);
	});
}

/** Its node types with a count each, whether a run asks you, and the computers it needs. */
function Steps({ overview }: { overview: FlowOverview }) {
	const { flow } = overview;
	const machines = useSpaceMachines();
	// The run's own computer is the one you start it on: only what the flow names.
	const needs = machines ? neededMachines(machines, null, flow.devices) : [];
	if (flow.nodeTypes.length === 0) return null;
	return (
		<Part label="Steps">
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
				{flow.nodeTypes.map(({ type, count }) => {
					const { icon: Icon, label } = NODE_TYPE[type];
					return (
						<Tooltip key={type}>
							<TooltipTrigger
								render={
									<span className="relative z-10 inline-flex items-center gap-1 tabular-nums" />
								}
							>
								<Icon className="size-3.5" aria-hidden="true" />
								{count}
								<span className="sr-only">{label}</span>
							</TooltipTrigger>
							<TooltipContent>
								{label}: {count}
							</TooltipContent>
						</Tooltip>
					);
				})}
				{flow.gateCount > 0 ? (
					<span className="inline-flex items-center gap-1 text-foreground">
						<UserRoundIcon className="size-3.5" aria-hidden="true" />
						Asks you {flow.gateCount === 1 ? "once" : `${flow.gateCount} times`}
					</span>
				) : null}
			</div>
			{needs.length > 0 ? (
				<div className="flex flex-wrap items-center gap-1.5 text-muted-foreground text-xs">
					<span>Needs</span>
					{needs.map((machine) => (
						<MachineBadge
							key={machine.name}
							machine={machine}
							label="Steps of this flow run here."
							className="relative z-10"
						/>
					))}
				</div>
			) : null}
		</Part>
	);
}

/** The status of its last runs, newest first, and how many that ended finished. */
function LastRuns({ overview }: { overview: FlowOverview }) {
	const { lastRuns, ended, finished } = overview;
	if (lastRuns.length === 0) {
		return (
			<Part label="Last runs">
				<span className="text-muted-foreground text-xs">Never run</span>
			</Part>
		);
	}
	return (
		<Part
			label={
				lastRuns.length === 1 ? "Last run" : `Last ${lastRuns.length} runs`
			}
		>
			<div className="flex items-end justify-between gap-2">
				<div className="flex items-center gap-0.5">
					{lastRuns.map((run, index) => (
						<Link
							// A run that calls the flow twice shows twice.
							key={`${run.runId}-${index}`}
							to="/runs/$runId"
							params={{ runId: run.runId }}
							className="relative z-10 rounded-sm p-0.5 hover:bg-muted"
						>
							<RunStatusIcon status={run.status} className="[&>svg]:size-3.5" />
						</Link>
					))}
				</div>
				{ended > 0 ? (
					<div className="flex flex-col items-end gap-0.5 tabular-nums">
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

function ProblemBadge({ problem }: { problem: FlowOverview["problem"] }) {
	if (!problem) return null;
	if (problem.kind === "does-not-load") {
		return (
			<Badge variant="destructive">
				<FileWarningIcon aria-hidden="true" />
				Does not load
			</Badge>
		);
	}
	if (problem.kind === "errors") {
		return (
			<Badge variant="destructive">
				<CircleAlertIcon aria-hidden="true" />
				{problem.count} {problem.count === 1 ? "error" : "errors"}
			</Badge>
		);
	}
	return (
		<Badge variant="outline">
			<CircleAlertIcon aria-hidden="true" />
			Last run failed
		</Badge>
	);
}

/** Run, and a menu to edit, see the schedules or delete. */
function FlowActions({
	projectId,
	overview,
	onRun,
	onDelete,
}: {
	projectId: string;
	overview: FlowOverview;
	onRun: () => void;
	onDelete: () => void;
}) {
	const { flow } = overview;
	const blockedBy = canStart(flow)
		? null
		: flow.nodeCount === null
			? "This flow does not load. Open it to see why."
			: "Fix the errors in the editor first.";
	return (
		<div className="relative z-10 ml-auto flex items-center gap-1">
			<Tooltip>
				<TooltipTrigger
					render={
						// A disabled button gets no hover; the span keeps the tooltip.
						<span className="inline-flex" />
					}
				>
					<Button
						size="sm"
						disabled={blockedBy !== null}
						aria-label={`Run ${flow.name}`}
						onClick={onRun}
					>
						<PlayIcon data-icon="inline-start" />
						Run
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					{blockedBy ?? "Start a run of this flow"}
				</TooltipContent>
			</Tooltip>
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
