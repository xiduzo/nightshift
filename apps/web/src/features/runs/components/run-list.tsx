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
import {
	CalendarClockIcon,
	GitBranchIcon,
	HistoryIcon,
	MonitorIcon,
	WebhookIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { walkerName } from "@/features/devices";
import type { Project, RunSummary } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import {
	costNote,
	formatDateTime,
	formatKnownCost,
	formatRelative,
	formatTime,
} from "@/shared/format";
import { RunStatusIcon } from "./run-status-badge";

/**
 * Runs as a table, newest first. Each row: a status icon, the title (a link
 * to the run) and its outcome under it; icons for the trigger, the device,
 * the cost and the branch, with how long ago it started under them, or the
 * time with `clockTimes`. What every run shares (one project) does not repeat
 * on each row. Narrow screens drop the icons. With `pageSize`, the runs show
 * in pages. With `more`, a button under the list loads the next runs.
 */
export function RunList({
	runs,
	projects,
	isLoading,
	emptyDescription,
	emptyAction,
	pageSize,
	more,
	clockTimes = false,
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
	/** Show when each run started ("10:37 PM"), for the runs of one night. */
	clockTimes?: boolean;
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

	// One project in the list: its name says nothing new on each row.
	const projectNames =
		projects && new Set(runs.map((run) => run.projectId)).size > 1
			? new Map(projects.map((p) => [p.id, p.name]))
			: undefined;

	return (
		<>
			<DataTable
				columns={runColumns(projectNames, clockTimes)}
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

/**
 * The columns of a run list; with `projectNames`, each title names its
 * project. With `clockTimes`, a run's start shows as a time of day.
 */
function runColumns(
	projectNames: Map<string, string> | undefined,
	clockTimes: boolean,
) {
	const projectOf = (run: RunSummary) =>
		projectNames
			? (projectNames.get(run.projectId) ?? "Unknown project")
			: null;
	return column.columns([
		column.accessor("title", {
			header: "Run",
			cell: ({ row }) => (
				<RunTitle run={row.original} projectName={projectOf(row.original)} />
			),
			// w-full + max-w-0 lets the title take the free width and truncate.
			meta: {
				headClassName: "pl-6",
				cellClassName: "w-full max-w-0 py-2.5 pl-6",
			},
		}),
		// Sorted by, never sortable: the newest run stays on top.
		column.accessor("createdAt", {
			id: "started",
			header: () => <span className="sr-only">Details</span>,
			cell: ({ row }) => (
				<>
					<RunFacts run={row.original} />
					<p className="mt-0.5 whitespace-nowrap text-right text-muted-foreground text-xs">
						<Started at={row.original.createdAt} clock={clockTimes} />
					</p>
				</>
			),
			meta: {
				headClassName: "w-0 pr-6",
				cellClassName: "w-0 py-2.5 pr-6 align-top",
			},
		}),
	]);
}

/**
 * The status icon and the title as a link over the whole row, then what
 * the icons do not say: the project, and the flow when the title hides it.
 * The outcome goes under it.
 */
function RunTitle({
	run,
	projectName,
}: {
	run: RunSummary;
	projectName: string | null;
}) {
	const context = [
		projectName,
		run.flowName === null
			? "Quick run"
			: run.title !== run.flowName
				? run.flowName
				: null,
	].filter((part) => part !== null);
	return (
		<>
			<div className="flex min-w-0 items-center gap-2">
				<RunStatusIcon status={run.status} result={run.result} />
				{/* The link covers the whole row, so the row is one target. */}
				<Link
					to="/runs/$runId"
					params={{ runId: run.id }}
					className="shrink-0 truncate font-medium outline-none after:absolute after:inset-0 after:rounded-sm focus-visible:after:ring-2 focus-visible:after:ring-ring/50 focus-visible:after:ring-inset"
				>
					{run.title}
				</Link>
				{context.length > 0 ? (
					<span className="truncate text-muted-foreground text-xs">
						{context.join(" · ")}
					</span>
				) : null}
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
			{run.reason ? (
				<p
					className="mt-0.5 truncate pl-6 text-muted-foreground text-xs"
					title={run.reason}
				>
					{run.reason}
				</p>
			) : null}
		</>
	);
}

/**
 * How the run started, where it runs, what it cost and its branch, as
 * icons with the details on hover. Nothing for a manual start, a run on
 * this computer, or a run that cost nothing.
 */
function RunFacts({ run }: { run: RunSummary }) {
	const { trigger } = run;
	const note = costNote(run);
	return (
		<div className="flex h-5 items-center justify-end gap-1 text-muted-foreground max-sm:hidden">
			{trigger.kind !== "manual" ? (
				<Fact
					label={
						trigger.kind === "webhook"
							? `Started by a webhook of the schedule ${trigger.scheduleId}, at ${formatDateTime(trigger.at)}`
							: `Started by the schedule ${trigger.scheduleId}, for ${formatDateTime(trigger.at)}`
					}
					copy={{ what: "schedule ID", value: trigger.scheduleId }}
				>
					{trigger.kind === "webhook" ? <WebhookIcon /> : <CalendarClockIcon />}
				</Fact>
			) : null}
			{run.device.thisDevice ? null : (
				<Fact
					label={`Runs on ${walkerName(run.device)}`}
					copy={{ what: "device name", value: walkerName(run.device) }}
				>
					<MonitorIcon />
				</Fact>
			)}
			{run.costUsd > 0 || note ? (
				<Fact
					label={note ?? "What the run cost"}
					copy={{ what: "cost", value: formatKnownCost(run) }}
				>
					<span
						className={
							note
								? "text-sm tabular-nums underline decoration-dotted underline-offset-4"
								: "text-sm tabular-nums"
						}
					>
						{formatKnownCost(run)}
					</span>
				</Fact>
			) : null}
			<Fact
				label={`Branch ${run.branch}`}
				copy={{ what: "branch name", value: run.branch }}
			>
				<GitBranchIcon />
			</Fact>
		</div>
	);
}

/**
 * One fact of RunFacts: its words on hover and for screen readers. A click
 * copies its value, which the copy cursor hints. It sits above the row's
 * link, so the click stays here.
 */
function Fact({
	label,
	copy,
	children,
}: {
	label: string;
	copy: { what: string; value: string };
	children: ReactNode;
}) {
	const onClick = async () => {
		try {
			await navigator.clipboard.writeText(copy.value);
			toast.success(`Copied the ${copy.what}.`);
		} catch {
			toast.error("Could not copy.");
		}
	};
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						onClick={onClick}
						className="relative z-10 flex cursor-copy items-center rounded-sm p-0.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&>svg]:size-3.5"
					/>
				}
			>
				{children}
				<span className="sr-only">
					{label}. Copy the {copy.what}.
				</span>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

function Started({ at, clock }: { at: number; clock: boolean }) {
	return (
		<time dateTime={new Date(at).toISOString()} title={formatDateTime(at)}>
			{clock ? formatTime(at) : formatRelative(at)}
		</time>
	);
}
