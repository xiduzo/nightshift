import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { Link } from "@tanstack/react-router";
import { CalendarClockIcon, HistoryIcon, WebhookIcon } from "lucide-react";
import type { ReactNode } from "react";
import { WalkerBadge } from "@/features/devices";
import type { Project, RunSummary } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { formatDateTime, formatRelative, formatTime } from "@/shared/format";
import { CostText } from "./cost-text";
import { RunStatusBadge } from "./run-status-badge";

/**
 * Runs as a table, newest first: status, title (a link to the run), project,
 * flow, branch, cost and start. Cost and start sort. Narrow screens keep
 * status, title and cost. With `pageSize`, the runs show in pages. With
 * `more`, a button under the list loads the next runs.
 */
export function RunList({
	runs,
	projects,
	isLoading,
	emptyDescription,
	emptyAction,
	pageSize,
	more,
}: {
	runs: RunSummary[] | undefined;
	/** Pass to show the project of each run. */
	projects?: Project[];
	isLoading: boolean;
	emptyDescription: string;
	/** A next step for the empty state, such as a button. */
	emptyAction?: ReactNode;
	/** Runs per page. Without it, every run shows. */
	pageSize?: number;
	/** There are more runs than the list holds: load them. */
	more?: { load: () => void; loading: boolean };
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
		<>
			<DataTable
				columns={runColumns(projectNames)}
				data={runs}
				getRowId={(run) => run.id}
				initialSorting={[{ id: "started", desc: true }]}
				rowClassName={() => "relative"}
				pageSize={pageSize}
			/>
			{more ? (
				<div className="flex justify-center border-t px-6 py-3">
					<Button
						variant="outline"
						size="sm"
						disabled={more.loading}
						onClick={more.load}
					>
						{more.loading ? <Spinner data-icon="inline-start" /> : null}
						Show older runs
					</Button>
				</div>
			) : null}
		</>
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
			cell: ({ row }) => (
				<RunStatusBadge
					status={row.original.status}
					result={row.original.result}
				/>
			),
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
			cell: ({ row }) => <CostText cost={row.original} />,
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
				{run.trigger.kind !== "manual" ? (
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
			{run.result && run.reason ? (
				<p
					className="mt-0.5 truncate text-muted-foreground text-xs"
					title={run.reason}
				>
					{run.reason}
				</p>
			) : null}
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

/** A run a schedule started, at its time or on a webhook; which schedule, and when, on hover. */
function ScheduledMark({
	trigger,
}: {
	trigger: Exclude<RunSummary["trigger"], { kind: "manual" }>;
}) {
	const webhook = trigger.kind === "webhook";
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span className="relative z-10 flex shrink-0 items-center gap-1 text-muted-foreground text-xs" />
				}
			>
				{webhook ? (
					<WebhookIcon className="size-3.5" aria-hidden="true" />
				) : (
					<CalendarClockIcon className="size-3.5" aria-hidden="true" />
				)}
				<span className="max-sm:sr-only">
					{webhook ? "webhook" : "scheduled"}
				</span>
			</TooltipTrigger>
			<TooltipContent>
				{webhook
					? `Started by a webhook of the schedule ${trigger.scheduleId}, at `
					: `Started by the schedule ${trigger.scheduleId}, for `}
				{formatDateTime(trigger.at)}
			</TooltipContent>
		</Tooltip>
	);
}
