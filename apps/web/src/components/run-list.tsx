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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
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

import { RunStatusBadge } from "./run-status-badge";

/**
 * Runs as a table, newest first: status, title (a link to the run), project,
 * flow, branch, cost and start. Narrow screens keep status, title and cost.
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
			<Empty className="py-10 md:py-10">
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

	const projectNames = new Map(projects?.map((p) => [p.id, p.name]));
	const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt);

	return (
		<Table>
			<TableHeader>
				<TableRow className="hover:bg-transparent">
					<TableHead className="w-0 pl-6">Status</TableHead>
					<TableHead>Run</TableHead>
					{projects ? (
						<TableHead className="hidden lg:table-cell">Project</TableHead>
					) : null}
					<TableHead className="hidden md:table-cell">Flow</TableHead>
					<TableHead className="hidden xl:table-cell">Branch</TableHead>
					<TableHead className="text-right max-sm:pr-6">Cost</TableHead>
					<TableHead className="hidden pr-6 text-right sm:table-cell">
						Started
					</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{sorted.map((run) => {
					const projectName = projects
						? (projectNames.get(run.projectId) ?? "Unknown project")
						: null;
					return (
						<TableRow key={run.id} className="relative">
							<TableCell className="w-0 py-3 pl-6">
								<RunStatusBadge status={run.status} />
							</TableCell>
							{/* w-full + max-w-0 lets the title take the free width and truncate. */}
							<TableCell className="w-full max-w-0 py-3">
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
							</TableCell>
							{projects ? (
								<TableCell className="hidden py-3 text-muted-foreground lg:table-cell">
									{projectName}
								</TableCell>
							) : null}
							<TableCell className="hidden py-3 md:table-cell">
								{run.flowName ? (
									<span className="font-mono text-xs">{run.flowName}</span>
								) : (
									<span className="text-muted-foreground">Quick run</span>
								)}
							</TableCell>
							<TableCell className="hidden py-3 font-mono text-muted-foreground text-xs xl:table-cell">
								{run.branch}
							</TableCell>
							<TableCell className="py-3 text-right tabular-nums max-sm:pr-6">
								{formatCost(run.costUsd)}
							</TableCell>
							<TableCell className="hidden py-3 pr-6 text-right text-muted-foreground sm:table-cell">
								<time
									dateTime={new Date(run.createdAt).toISOString()}
									title={formatDateTime(run.createdAt)}
								>
									{formatRelative(run.createdAt)}
								</time>
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
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
