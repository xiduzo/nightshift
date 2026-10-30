/** PROTOTYPE, throw away. Pieces the Flows page variants share. */

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
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@nightshift/ui/components/input-group";
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
import {
	CalendarClockIcon,
	CircleAlertIcon,
	FileWarningIcon,
	HandIcon,
	type LucideIcon,
	MoreHorizontalIcon,
	PencilIcon,
	PlayIcon,
	SearchIcon,
	Trash2Icon,
	UserRoundIcon,
	WebhookIcon,
	WorkflowIcon,
} from "lucide-react";
import { useState } from "react";
import { NODE_TYPE } from "@/features/flows";
import { RunStatusIcon } from "@/features/runs";
import type { FlowListItem, ScheduleSummary } from "@/shared/api";
import {
	dayWord,
	formatDateTime,
	formatRelative,
	formatTime,
} from "@/shared/format";
import {
	type FlowRow,
	scheduleText,
	startsOnItsOwn,
	type Trigger,
} from "./flows-data";

const TRIGGER_ICON: Record<Trigger["kind"], LucideIcon> = {
	schedule: CalendarClockIcon,
	webhook: WebhookIcon,
	subflow: WorkflowIcon,
};

/** Why the flow cannot start now, or null. */
export function runBlockedBy(flow: FlowListItem): string | null {
	if (canStart(flow)) return null;
	return flow.nodeCount === null
		? "This flow does not load. Open it to see why."
		: "Fix the errors in the editor first.";
}

// ---------------------------------------------------------------------------
// Search and filter

type Filter = "all" | "scheduled" | "subflow" | "hand" | "attention";

const FILTERS: {
	value: Filter;
	label: string;
	test: (row: FlowRow) => boolean;
}[] = [
	{ value: "all", label: "All", test: () => true },
	{ value: "scheduled", label: "Start on their own", test: startsOnItsOwn },
	{
		value: "subflow",
		label: "Subflows",
		test: (row) => row.flow.callers.length > 0,
	},
	{
		value: "hand",
		label: "Only by hand",
		test: (row) => row.triggers.length === 0,
	},
	{
		value: "attention",
		label: "Need a look",
		test: (row) => row.problem !== null,
	},
];

/** The rows a search and a filter leave, and the toolbar that sets them. */
export function useFlowFilter(rows: FlowRow[] | undefined) {
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	const test = FILTERS.find((f) => f.value === filter)?.test ?? (() => true);
	const needle = query.trim().toLowerCase();
	const shown = (rows ?? []).filter(
		(row) =>
			test(row) &&
			(needle === "" ||
				row.name.toLowerCase().includes(needle) ||
				(row.flow.description ?? "").toLowerCase().includes(needle)),
	);
	const toolbar = (
		<div className="flex flex-wrap items-center gap-2">
			<InputGroup className="w-full sm:w-64">
				<InputGroupAddon>
					<SearchIcon aria-hidden="true" />
				</InputGroupAddon>
				<InputGroupInput
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search flows"
					aria-label="Search flows"
				/>
			</InputGroup>
			<ToggleGroup
				variant="outline"
				size="sm"
				spacing={0}
				value={[filter]}
				onValueChange={(next) => {
					const [value] = next as Filter[];
					if (value) setFilter(value);
				}}
			>
				{FILTERS.map((f) => {
					const count = (rows ?? []).filter(f.test).length;
					return (
						<ToggleGroupItem key={f.value} value={f.value}>
							{f.label}
							{f.value !== "all" && count > 0 ? (
								<Badge
									variant={
										f.value === "attention" ? "destructive" : "secondary"
									}
									className="tabular-nums"
								>
									{count}
								</Badge>
							) : null}
						</ToggleGroupItem>
					);
				})}
			</ToggleGroup>
		</div>
	);
	return { shown, toolbar };
}

// ---------------------------------------------------------------------------
// How it starts

/** What a trigger says in one short line. */
function triggerText(trigger: Trigger): string {
	if (trigger.kind === "subflow") return trigger.caller;
	return scheduleText(trigger.schedule);
}

/** A short form for a chip: "Daily 22:00", "Webhook", "In feature-factory". */
function triggerChip(trigger: Trigger): string {
	if (trigger.kind === "subflow") return `In ${trigger.caller}`;
	if (trigger.kind === "webhook") return "Webhook";
	return scheduleText(trigger.schedule)
		.replace(/^Every day at /, "Daily ")
		.replace(/^Weekdays at /, "Weekdays ");
}

function paused(trigger: Trigger): boolean {
	return trigger.kind !== "subflow" && !trigger.schedule.enabled;
}

/**
 * Every way the flow starts besides you, one line each: its schedules (with
 * the next start), its webhooks and the flows that run it. A flow nothing
 * starts says so. Past `max` lines, the rest sit in a tooltip.
 */
export function StartedBy({
	row,
	now,
	max = 2,
}: {
	row: FlowRow;
	now: number;
	max?: number;
}) {
	if (row.triggers.length === 0) {
		return (
			<span className="flex items-center gap-2 text-muted-foreground">
				<HandIcon className="size-4 shrink-0" aria-hidden="true" />
				Only when you run it
			</span>
		);
	}
	const shown = row.triggers.slice(0, max);
	const rest = row.triggers.slice(max);
	return (
		<ul className="flex min-w-0 flex-col gap-1.5">
			{shown.map((trigger, index) => (
				<TriggerLine key={index} trigger={trigger} now={now} />
			))}
			{rest.length > 0 ? (
				<li>
					<Tooltip>
						<TooltipTrigger
							render={
								<span className="text-muted-foreground text-xs underline decoration-dotted underline-offset-4" />
							}
						>
							{rest.length} more
						</TooltipTrigger>
						<TooltipContent className="flex flex-col items-start gap-0.5">
							{rest.map((trigger, index) => (
								<span key={index}>
									{trigger.kind === "subflow" ? "Run by " : ""}
									{triggerText(trigger)}
									{paused(trigger) ? " (paused)" : ""}
								</span>
							))}
						</TooltipContent>
					</Tooltip>
				</li>
			) : null}
		</ul>
	);
}

function TriggerLine({ trigger, now }: { trigger: Trigger; now: number }) {
	const Icon = TRIGGER_ICON[trigger.kind];
	const off = paused(trigger);
	return (
		<li
			className={cn(
				"flex min-w-0 items-start gap-2",
				off && "text-muted-foreground",
			)}
		>
			<Icon
				className="mt-0.5 size-4 shrink-0 text-muted-foreground"
				aria-hidden="true"
			/>
			<div className="flex min-w-0 flex-col gap-0.5">
				{trigger.kind === "subflow" ? (
					<span className="truncate">
						Run by <span className="font-mono">{trigger.caller}</span>
					</span>
				) : (
					<span className="truncate">{triggerText(trigger)}</span>
				)}
				{trigger.kind === "subflow" ? null : off ? (
					<span className="text-xs">Paused</span>
				) : (
					<NextStart schedule={trigger.schedule} now={now} />
				)}
			</div>
		</li>
	);
}

/** The ways it starts as small chips, for a card or an item. */
export function TriggerChips({ row }: { row: FlowRow }) {
	if (row.triggers.length === 0) {
		return (
			<Badge variant="outline" className="font-normal text-muted-foreground">
				<HandIcon aria-hidden="true" />
				Only by hand
			</Badge>
		);
	}
	return (
		<>
			{row.triggers.map((trigger, index) => {
				const Icon = TRIGGER_ICON[trigger.kind];
				const off = paused(trigger);
				return (
					<Badge
						key={index}
						variant={off ? "outline" : "secondary"}
						className={cn(
							"font-normal",
							trigger.kind === "subflow" && "font-mono",
							off && "text-muted-foreground line-through",
						)}
						title={off ? "Paused" : undefined}
					>
						<Icon aria-hidden="true" />
						{triggerChip(trigger)}
					</Badge>
				);
			})}
		</>
	);
}

export function NextStart({
	schedule,
	now,
}: {
	schedule: ScheduleSummary;
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

// ---------------------------------------------------------------------------
// What is in it

/** The node types it has, with a count each, and whether a run asks you. */
export function StepsLine({ row }: { row: FlowRow }) {
	if (row.steps.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
			{row.steps.map(({ type, count }) => {
				const { icon: Icon, label } = NODE_TYPE[type];
				return (
					<Tooltip key={type}>
						<TooltipTrigger
							render={
								<span className="inline-flex items-center gap-1 tabular-nums" />
							}
						>
							<Icon className="size-3.5" aria-hidden="true" />
							{count}
							<span className="sr-only">{label}</span>
						</TooltipTrigger>
						<TooltipContent>
							{count} {label}
						</TooltipContent>
					</Tooltip>
				);
			})}
			{row.gates > 0 ? (
				<span className="inline-flex items-center gap-1 text-foreground">
					<UserRoundIcon className="size-3.5" aria-hidden="true" />
					Asks you {row.gates === 1 ? "once" : `${row.gates} times`}
				</span>
			) : null}
		</div>
	);
}

// ---------------------------------------------------------------------------
// How its runs went

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
				{health.lastRuns.slice(0, max).map((run, index) => (
					<Link
						// A run that calls the flow twice shows twice.
						key={`${run.runId}-${index}`}
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

// ---------------------------------------------------------------------------
// Actions

/** Run, and a menu to edit or delete. */
export function FlowActions({
	projectId,
	row,
	onRun,
	onDelete,
	runLabel = true,
	runVariant = "outline",
}: {
	projectId: string;
	row: FlowRow;
	onRun: () => void;
	onDelete: () => void;
	runLabel?: boolean;
	runVariant?: "outline" | "default";
}) {
	const blocked = runBlockedBy(row.flow);
	return (
		<div className="relative z-10 flex items-center gap-1">
			<Tooltip>
				<TooltipTrigger render={<span className="inline-flex" />}>
					<Button
						size={runLabel ? "sm" : "icon-sm"}
						variant={runVariant}
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
