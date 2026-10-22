import { Badge } from "@nightshift/ui/components/badge";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { DropdownMenuItem } from "@nightshift/ui/components/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import { FolderGitIcon, FolderOpenIcon } from "lucide-react";
import type { Project, RunSummary } from "@/shared/api";
import { formatDateTime, formatRelative } from "@/shared/format";
import { ProjectMenu } from "./project-menu";
import { projectFolder } from "./projects";

/** The projects as cards: open, rename, move or remove one. */
export function ProjectList({
	projects,
	runs,
	isLoading,
}: {
	projects: Project[] | undefined;
	runs: RunSummary[] | undefined;
	isLoading: boolean;
}) {
	if (isLoading) {
		return (
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				<Skeleton className="h-32 w-full rounded-xl" />
				<Skeleton className="h-32 w-full rounded-xl" />
			</div>
		);
	}

	if (!projects || projects.length === 0) {
		return (
			<Card>
				<CardContent>
					<Empty>
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<FolderGitIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>No projects yet</EmptyTitle>
							<EmptyDescription>
								A project is a git repository Night Shift works on. Add one with
								+ next to Projects in the sidebar.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				</CardContent>
			</Card>
		);
	}

	return (
		<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
			{projects.map((project) => (
				<ProjectCard
					key={project.id}
					project={project}
					runs={runs?.filter((run) => run.projectId === project.id)}
				/>
			))}
		</div>
	);
}

function ProjectCard({
	project,
	runs,
}: {
	project: Project;
	/** This project's runs, when loaded. */
	runs: RunSummary[] | undefined;
}) {
	const last = runs?.reduce<RunSummary | undefined>(
		(latest, run) =>
			latest === undefined || run.createdAt > latest.createdAt ? run : latest,
		undefined,
	);
	const active =
		runs?.filter(
			(run) =>
				run.status === "running" ||
				run.status === "waiting" ||
				run.status === "sleeping",
		).length ?? 0;

	return (
		<Card
			size="sm"
			className="relative transition-colors hover:bg-muted/40 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring/50"
		>
			<CardHeader>
				<CardTitle className="flex min-w-0 items-center gap-2">
					<FolderGitIcon
						className="size-4 shrink-0 text-muted-foreground"
						aria-hidden="true"
					/>
					{/* The link covers the card, so the card is one target. */}
					<Link
						to="/projects/$projectId"
						params={{ projectId: project.id }}
						className="truncate outline-none after:absolute after:inset-0"
					>
						{project.name}
					</Link>
				</CardTitle>
				<CardDescription
					className="truncate font-mono text-xs"
					title={projectFolder(project)}
				>
					{projectFolder(project)}
				</CardDescription>
				<CardAction className="relative z-10">
					<ProjectMenu project={project}>
						<DropdownMenuItem
							render={
								<Link
									to="/projects/$projectId"
									params={{ projectId: project.id }}
								/>
							}
						>
							<FolderOpenIcon aria-hidden="true" />
							Open project
						</DropdownMenuItem>
					</ProjectMenu>
				</CardAction>
			</CardHeader>
			<CardFooter className="gap-2 text-muted-foreground text-xs">
				{runs === undefined ? (
					<Skeleton className="h-4 w-32" />
				) : last ? (
					<>
						<span className="tabular-nums">
							{runs.length} {runs.length === 1 ? "run" : "runs"}
						</span>
						<span aria-hidden="true">·</span>
						<span className="truncate">
							last{" "}
							<time
								dateTime={new Date(last.createdAt).toISOString()}
								title={formatDateTime(last.createdAt)}
							>
								{formatRelative(last.createdAt)}
							</time>
						</span>
						{active > 0 ? (
							<Badge
								variant="outline"
								className="ml-auto border-status-running/40 bg-status-running/10 text-status-running"
							>
								{active} active
							</Badge>
						) : null}
					</>
				) : (
					"No runs yet"
				)}
			</CardFooter>
		</Card>
	);
}
