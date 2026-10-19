import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { Link } from "@tanstack/react-router";
import { CalendarClockIcon, HistoryIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { Project, RunSummary } from "@/lib/api-types";
import {
	formatCost,
	formatDateTime,
	formatRelative,
	formatTime,
} from "@/lib/format";

import { DataTable, dataTableColumns } from "./data-table";
import { WalkerBadge } from "./run/walker-badge";
import { RunStatusBadge } from "./run-status-badge";

/**
 * Runs as a table, newest first: status, title (a link to the run), project,
 * flow, branch, cost and start. Cost and start sort. Narrow screens keep
 * status, title and cost.
 */
export function RunList({
	runs,
	projects,
	isLoading,
	emptyDescription,
	emptyAction,
}: {
	runs: RunSummary[] | undefined;
	/** Pass to show the project of each run. */
	projects?: Project[];
	isLoading: boolean;
	emptyDescription: string;
	/** A next step for the empty state, such as a button. */
	emptyAction?: ReactNode;
}) {
	if (isLoading) {
		return (
			<div className="flex flex-col gap-2 px-6 py-4">
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-9 w-full" />
				<Skeleton className="h-9 w-full" />
			</div>
		);
	}

	if (!runs || runs.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<HistoryIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No runs yet</EmptyTitle>
					<EmptyDescription>{emptyDescription}</EmptyDescription>
				</EmptyHeader>
				{emptyAction ? <EmptyContent>{emptyAction}</EmptyContent> : null}
			</Empty>
		);
	}

	const projectNames = projects
		? new Map(projects.map((p) => [p.id, p.name]))
		: undefined;

	return (
		<DataTable
			columns={runColumns(projectNames)}
			data={runs}
			getRowId={(run) => run.id}
			initialSorting={[{ id: "started", desc: true }]}
			rowClassName={() => "relative"}
		/>
	);
}

const column = dataTableColumns<RunSummary>();

/** The columns of a run list; with `projectNames`, a Project column too. */
function runColumns(projectNames: Map<string, string> | undefined) {
	const projectOf = (run: RunSummary) =>
		projectNames
			? (projectNames.get(run.projectId) ?? "Unknown project")
			: null;
	return column.columns([
		column.accessor("status", {
			header: "Status",
			cell: ({ row }) => <RunStatusBadge status={row.original.status} />,
			meta: { headClassName: "w-0 pl-6", cellClassName: "w-0 py-3 pl-6" },
		}),
		column.accessor("title", {
			header: "Run",
			cell: ({ row }) => (
				<RunTitle run={row.original} projectName={projectOf(row.original)} />
			),
			// w-full + max-w-0 lets the title take the free width and truncate.
			meta: { cellClassName: "w-full max-w-0 py-3" },
		}),
		...(projectNames
			? [
					column.accessor((run) => projectOf(run), {
						id: "project",
						header: "Project",
						meta: {
							headClassName: "hidden lg:table-cell",
							cellClassName: "hidden py-3 text-muted-foreground lg:table-cell",
						},
					}),
				]
			: []),
		column.accessor("flowName", {
			header: "Flow",
			cell: ({ row }) =>
				row.original.flowName ? (
					<span className="font-mono text-xs">{row.original.flowName}</span>
				) : (
					<span className="text-muted-foreground">Quick run</span>
				),
			meta: {
				headClassName: "hidden md:table-cell",
				cellClassName: "hidden py-3 md:table-cell",
			},
		}),
		column.accessor("branch", {
			header: "Branch",
			meta: {
				headClassName: "hidden xl:table-cell",
				cellClassName:
					"hidden py-3 font-mono text-muted-foreground text-xs xl:table-cell",
			},
		}),
		column.accessor("costUsd", {
			header: "Cost",
			enableSorting: true,
			cell: ({ row }) => formatCost(row.original.costUsd),
			meta: {
				headClassName: "text-right max-sm:pr-6",
				cellClassName: "py-3 text-right tabular-nums max-sm:pr-6",
			},
		}),
		column.accessor("createdAt", {
			id: "started",
			header: "Started",
			enableSorting: true,
			cell: ({ row }) => (
				<time
					dateTime={new Date(row.original.createdAt).toISOString()}
					title={formatDateTime(row.original.createdAt)}
				>
					{formatRelative(row.original.createdAt)}
				</time>
			),
			meta: {
				headClassName: "hidden pr-6 text-right sm:table-cell",
				cellClassName:
					"hidden py-3 pr-6 text-right text-muted-foreground sm:table-cell",
			},
		}),
	]);
}

/** The run's title as a link over the whole row, with what narrow screens hide. */
function RunTitle({
	run,
	projectName,
}: {
	run: RunSummary;
	projectName: string | null;
}) {
	return (
		<>
			<div className="flex min-w-0 items-center gap-2">
				{/* The link covers the whole row, so the row is one target. */}
				<Link
					to="/runs/$runId"
					params={{ runId: run.id }}
					className="truncate font-medium outline-none after:absolute after:inset-0 after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
				>
					{run.title}
				</Link>
				{run.trigger.kind === "schedule" ? (
					<ScheduledMark trigger={run.trigger} />
				) : null}
				<WalkerBadge walker={run.device} className="relative z-10" />
				{run.status === "sleeping" && run.wakeAt ? (
					<span className="shrink-0 text-status-sleeping text-xs">
						wakes{" "}
						<time
							dateTime={new Date(run.wakeAt).toISOString()}
							title={formatDateTime(run.wakeAt)}
						>
							{formatTime(run.wakeAt)}
						</time>
					</span>
				) : null}
			</div>
			{/* What the hidden columns hold, on one line, on narrow screens. */}
			<div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs sm:hidden">
				{projectName ? (
					<>
						<span className="truncate">{projectName}</span>
						<span aria-hidden="true">·</span>
					</>
				) : null}
				<time
					className="shrink-0"
					dateTime={new Date(run.createdAt).toISOString()}
					title={formatDateTime(run.createdAt)}
				>
					{formatRelative(run.createdAt)}
				</time>
			</div>
		</>
	);
}

/** A run a schedule started; which schedule, and for when, on hover. */
function ScheduledMark({
	trigger,
}: {
	trigger: Extract<RunSummary["trigger"], { kind: "schedule" }>;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span className="relative z-10 flex shrink-0 items-center gap-1 text-muted-foreground text-xs" />
				}
			>
				<CalendarClockIcon className="size-3.5" aria-hidden="true" />
				<span className="max-sm:sr-only">scheduled</span>
			</TooltipTrigger>
			<TooltipContent>
				Started by the schedule {trigger.scheduleId}, for{" "}
				{formatDateTime(trigger.at)}
			</TooltipContent>
		</Tooltip>
	);
}
