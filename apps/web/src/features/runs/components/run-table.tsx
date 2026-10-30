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
import type { RunSummary } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	formatDateTime,
	formatDuration,
	formatRelative,
	formatTime,
	formatTokens,
} from "@/shared/format";
import { CostText } from "./cost-text";
import { Elapsed } from "./elapsed";
import { RunStatusBadge } from "./run-status-badge";

/**
 * A project's runs as a table, newest first: status, title (a link to the
 * run), flow, cost, tokens, length and start. Cost, tokens, length and
 * start sort. Narrow screens keep status, title and cost. With `more`, a
 * button under the table loads the next runs.
 */
export function RunTable({
	runs,
	isLoading,
	emptyDescription,
	emptyAction,
	more,
}: {
	runs: RunSummary[] | undefined;
	isLoading: boolean;
	emptyDescription: string;
	/** A next step for the empty state, such as a button. */
	emptyAction?: ReactNode;
	/** There are more runs than the table holds: load them. */
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

	return (
		<>
			<DataTable
				columns={RUN_COLUMNS}
				data={runs}
				getRowId={(run) => run.id}
				initialSorting={[{ id: "started", desc: true }]}
				rowClassName={() => "relative"}
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

/** Every token a run's agents used, in and out. Zero when Night Shift does not know. */
function tokensOf(run: RunSummary): number {
	const tokens = run.metrics?.tokens;
	return tokens ? tokens.input + tokens.output : 0;
}

/** How long an ended run took, from start to end. Null while it is open. */
function lengthOf(run: RunSummary): number | null {
	if (run.metrics) return run.metrics.wallMs;
	return run.endedAt === null ? null : run.endedAt - run.createdAt;
}

const column = dataTableColumns<RunSummary>();

const RUN_COLUMNS = column.columns([
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
		cell: ({ row }) => <RunTitle run={row.original} />,
		// w-full + max-w-0 lets the title take the free width and truncate.
		meta: { cellClassName: "w-full max-w-0 py-3" },
	}),
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
	column.accessor("costUsd", {
		header: "Cost",
		enableSorting: true,
		cell: ({ row }) => <CostText cost={row.original} />,
		meta: {
			headClassName: "text-right max-sm:pr-6",
			cellClassName: "py-3 text-right tabular-nums max-sm:pr-6",
		},
	}),
	column.accessor(tokensOf, {
		id: "tokens",
		header: "Tokens",
		enableSorting: true,
		cell: ({ row }) => <RunTokens run={row.original} />,
		meta: {
			headClassName: "hidden text-right lg:table-cell",
			cellClassName: "hidden py-3 text-right tabular-nums lg:table-cell",
		},
	}),
	column.accessor((run) => lengthOf(run) ?? Number.POSITIVE_INFINITY, {
		id: "length",
		header: "Length",
		enableSorting: true,
		cell: ({ row }) => <RunLength run={row.original} />,
		meta: {
			headClassName: "hidden text-right md:table-cell",
			cellClassName:
				"hidden py-3 text-right text-muted-foreground tabular-nums md:table-cell",
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

/** The tokens a run's agents used; in, out and from the cache on hover. */
function RunTokens({ run }: { run: RunSummary }) {
	const tokens = run.metrics?.tokens;
	if (!tokens || tokens.input + tokens.output === 0) {
		return <span className="text-muted-foreground">—</span>;
	}
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span className="relative z-10 underline decoration-dotted underline-offset-4" />
				}
			>
				{formatTokens(tokens.input + tokens.output)}
			</TooltipTrigger>
			<TooltipContent>
				{formatTokens(tokens.input)} in, {formatTokens(tokens.output)} out.{" "}
				{formatTokens(tokens.cacheRead)} of the input came from the cache.
			</TooltipContent>
		</Tooltip>
	);
}

/** How long the run took; while it is open, how long it has been going. */
function RunLength({ run }: { run: RunSummary }) {
	const length = lengthOf(run);
	if (length !== null) return <>{formatDuration(length)}</>;
	return <Elapsed start={run.createdAt} end={null} />;
}

/** The run's title as a link over the whole row, with what narrow screens hide. */
function RunTitle({ run }: { run: RunSummary }) {
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
