import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleAlertIcon, GitBranchIcon } from "lucide-react";
import { ProjectPage, projectQueries } from "@/features/projects";
import type { RunCopy } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { formatDateTime, formatRelative } from "@/shared/format";
import { PageHeading } from "@/shared/page";
import { LocalTime } from "@/shared/time";
import { RunStatusBadge } from "../components/run-status-badge";
import { RunCopyMenu } from "./run-copy-menu";

/**
 * A project's Branches page: what its runs left on this computer (their
 * own copy of the project and their branches), whether that work is
 * merged or pushed, and the two removals.
 */
export function ProjectRunCopiesPage({ projectId }: { projectId: string }) {
	return (
		<ProjectPage projectId={projectId} section="Branches">
			{(project) => (
				<section
					aria-labelledby="branches-heading"
					className="flex flex-col gap-4"
				>
					<PageHeading
						id="branches-heading"
						title="Branches"
						description="Each run works in its own copy of the project. Remove the copies and branches you no longer need."
					/>
					<RunCopies projectId={project.id} />
				</section>
			)}
		</ProjectPage>
	);
}

function RunCopies({ projectId }: { projectId: string }) {
	const copies = useQuery(projectQueries.runCopies(projectId));

	if (copies.error) {
		return (
			<Alert variant="destructive">
				<CircleAlertIcon />
				<AlertTitle>The branches did not load</AlertTitle>
				<AlertDescription>{copies.error.message}</AlertDescription>
			</Alert>
		);
	}

	return (
		<Card className="py-0">
			<CardContent className="px-0">
				{copies.isLoading ? (
					<div className="flex flex-col gap-2 px-6 py-4">
						<Skeleton className="h-9 w-full" />
						<Skeleton className="h-9 w-full" />
					</div>
				) : !copies.data || copies.data.copies.length === 0 ? (
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<GitBranchIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>Nothing left on this computer</EmptyTitle>
							<EmptyDescription>
								When a run ends, its copy and branches show here.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<DataTable
						columns={copyColumns(projectId, copies.data.defaultBranch)}
						data={copies.data.copies}
						getRowId={(copy) => copy.runId}
					/>
				)}
			</CardContent>
		</Card>
	);
}

const column = dataTableColumns<RunCopy>();

function copyColumns(projectId: string, defaultBranch: string | null) {
	return column.columns([
		column.accessor("title", {
			header: "Run",
			cell: ({ row }) => <RunCell copy={row.original} />,
			meta: {
				headClassName: "pl-6",
				cellClassName: "w-full max-w-0 py-3 pl-6",
			},
		}),
		column.accessor("branches", {
			header: "Branches",
			cell: ({ row }) => (
				<BranchList copy={row.original} defaultBranch={defaultBranch} />
			),
			meta: {
				headClassName: "hidden md:table-cell",
				cellClassName: "hidden py-3 md:table-cell",
			},
		}),
		column.accessor("copy", {
			header: "Copy",
			cell: ({ row }) => <CopyBadge copy={row.original} />,
			meta: { cellClassName: "py-3" },
		}),
		column.display({
			id: "actions",
			header: () => <span className="sr-only">Actions</span>,
			cell: ({ row }) => (
				<RunCopyMenu projectId={projectId} copy={row.original} />
			),
			meta: {
				headClassName: "w-0 pr-6",
				cellClassName: "w-0 py-3 pr-6 text-right",
			},
		}),
	]);
}

/** The run (a link), its status, when it ended, and what the cleanup does with it. */
function RunCell({ copy }: { copy: RunCopy }) {
	const ended = copy.endedAt ?? copy.createdAt;
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<div className="flex min-w-0 items-center gap-2">
				<RunStatusBadge status={copy.status} className="shrink-0" />
				<Link
					to="/runs/$runId"
					params={{ runId: copy.runId }}
					className="truncate font-medium hover:underline"
				>
					{copy.title}
				</Link>
			</div>
			<p className="text-muted-foreground text-xs">
				{copy.active ? (
					"The run is not done. Night Shift keeps its copy until it ends."
				) : (
					<>
						{copy.endedAt ? "Ended " : "Started "}
						<LocalTime at={ended}>{formatRelative(ended)}</LocalTime>
						{copy.removed && !hasLeftovers(copy) ? (
							<>
								. Removed{" "}
								{copy.removed.by === "cleanup" ? "by the cleanup " : ""}
								<LocalTime at={copy.removed.at}>
									{formatRelative(copy.removed.at)}
								</LocalTime>
							</>
						) : copy.cleanupAt ? (
							<>
								. Cleaned up from{" "}
								<LocalTime at={copy.cleanupAt}>
									{formatDateTime(copy.cleanupAt)}
								</LocalTime>
							</>
						) : hasLeftovers(copy) && !copy.safe ? (
							". Kept until you remove it."
						) : null}
					</>
				)}
			</p>
		</div>
	);
}

function hasLeftovers(copy: RunCopy): boolean {
	return copy.copy || copy.branches.length > 0;
}

/** Each local branch of the run, and where its work is. */
function BranchList({
	copy,
	defaultBranch,
}: {
	copy: RunCopy;
	defaultBranch: string | null;
}) {
	if (copy.branches.length === 0) {
		return <span className="text-muted-foreground">None</span>;
	}
	return (
		<ul className="flex flex-col gap-1">
			{copy.branches.map((branch) => (
				<li key={branch.name} className="flex min-w-0 items-center gap-2">
					<span className="truncate font-mono text-xs">{branch.name}</span>
					{branch.merged ? (
						<Badge
							variant="secondary"
							title={defaultBranch ? `In ${defaultBranch}` : undefined}
						>
							Merged
						</Badge>
					) : branch.unsaved > 0 ? (
						<Badge variant="destructive">
							{branch.unsaved === 1
								? "1 commit only here"
								: `${branch.unsaved} commits only here`}
						</Badge>
					) : branch.pushed ? (
						<Badge variant="secondary">Pushed</Badge>
					) : (
						<Badge variant="outline">Nothing new</Badge>
					)}
				</li>
			))}
		</ul>
	);
}

/** Whether the run's copy is here, and its changes that are not committed. */
function CopyBadge({ copy }: { copy: RunCopy }) {
	if (!copy.copy) {
		return (
			<span className="text-muted-foreground">
				{copy.removed ? "Removed" : "None"}
			</span>
		);
	}
	if (copy.changes === null) {
		return <Badge variant="outline">On this computer</Badge>;
	}
	if (copy.changes > 0) {
		return (
			<Badge variant="destructive">
				{copy.changes === 1
					? "1 file not committed"
					: `${copy.changes} files not committed`}
			</Badge>
		);
	}
	return <Badge variant="outline">On this computer</Badge>;
}
