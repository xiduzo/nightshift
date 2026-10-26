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
import type { Project } from "@/shared/api";
import { formatDateTime, formatRelative } from "@/shared/format";
import { ProjectMenu } from "./project-menu";
import { projectFolder } from "./projects";

/** The projects as cards: open, rename, move or remove one. */
export function ProjectList({
	projects,
	isLoading,
}: {
	projects: Project[] | undefined;
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
				<ProjectCard key={project.id} project={project} />
			))}
		</div>
	);
}

function ProjectCard({ project }: { project: Project }) {
	const { runs } = project;
	const last = runs?.last;
	const active =
		(runs?.statuses.running ?? 0) +
		(runs?.statuses.waiting ?? 0) +
		(runs?.statuses.sleeping ?? 0);

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
							{runs.total} {runs.total === 1 ? "run" : "runs"}
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
