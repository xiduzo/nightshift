import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Link } from "@tanstack/react-router";

import type { Project, RunSummary } from "@/lib/api-types";
import { formatCost, formatDateTime, formatRelative } from "@/lib/format";

import { RunStatusBadge } from "./run-status-badge";

export function RunList({
	runs,
	projects,
	isLoading,
	emptyDescription,
}: {
	runs: RunSummary[] | undefined;
	/** Pass to show the project of each run. */
	projects?: Project[];
	isLoading: boolean;
	emptyDescription: string;
}) {
	if (isLoading) {
		return (
			<div className="flex flex-col gap-1.5">
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
			</div>
		);
	}

	if (!runs || runs.length === 0) {
		return (
			<Empty className="border p-6 md:p-6">
				<EmptyHeader>
					<EmptyTitle>No runs yet</EmptyTitle>
					<EmptyDescription>{emptyDescription}</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	const projectNames = new Map(projects?.map((p) => [p.id, p.name]));
	const sorted = [...runs].sort((a, b) => b.createdAt - a.createdAt);

	return (
		<ul className="flex flex-col divide-y border">
			{sorted.map((run) => (
				<li key={run.id}>
					<Link
						to="/runs/$runId"
						params={{ runId: run.id }}
						className="flex flex-col gap-1 px-3 py-2 outline-none hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
					>
						<div className="flex min-w-0 items-center gap-2">
							<RunStatusBadge status={run.status} />
							<span className="min-w-0 flex-1 truncate text-sm">
								{run.title}
							</span>
						</div>
						<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground text-xs">
							{projects ? (
								<span className="font-medium text-foreground/80">
									{projectNames.get(run.projectId) ?? "Unknown project"}
								</span>
							) : null}
							<span>{run.flowName ? "Flow" : "Quick run"}</span>
							<span className="truncate font-mono">{run.branch}</span>
							<span>{formatCost(run.costUsd)}</span>
							<time
								dateTime={new Date(run.createdAt).toISOString()}
								title={formatDateTime(run.createdAt)}
							>
								{formatRelative(run.createdAt)}
							</time>
						</div>
					</Link>
				</li>
			))}
		</ul>
	);
}
