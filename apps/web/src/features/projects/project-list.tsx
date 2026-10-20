import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	ArrowRightLeftIcon,
	FolderGitIcon,
	FolderOpenIcon,
	MoreHorizontalIcon,
	PencilIcon,
	Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Project, RunSummary } from "@/shared/api";
import { formatDateTime, formatRelative } from "@/shared/format";
import { MoveProjectDialog, RenameProjectDialog } from "./project-actions";
import { projectFolder } from "./projects";
import { projectMutations, projectQueries } from "./queries";

/**
 * The projects as cards: open, rename, move or remove one. `onRemoved` runs
 * after a project is removed, for the data of other verticals (its runs).
 */
export function ProjectList({
	projects,
	runs,
	isLoading,
	onRemoved,
}: {
	projects: Project[] | undefined;
	runs: RunSummary[] | undefined;
	isLoading: boolean;
	onRemoved?: () => void;
}) {
	const queryClient = useQueryClient();
	const [toRemove, setToRemove] = useState<Project | null>(null);
	const [toRename, setToRename] = useState<Project | null>(null);
	const [toMove, setToMove] = useState<Project | null>(null);
	const removeProject = useMutation(
		projectMutations.remove({
			onSuccess: () => {
				setToRemove(null);
				void queryClient.invalidateQueries({ queryKey: projectQueries.all() });
				onRemoved?.();
			},
			onError: (error) => toast.error(error.message),
		}),
	);

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
		<>
			<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
				{projects.map((project) => (
					<ProjectCard
						key={project.id}
						project={project}
						runs={runs?.filter((run) => run.projectId === project.id)}
						removing={removeProject.isPending}
						onRemove={() => setToRemove(project)}
						onRename={() => setToRename(project)}
						onMove={() => setToMove(project)}
					/>
				))}
			</div>
			<RenameProjectDialog
				project={toRename}
				onOpenChange={(open) => {
					if (!open) setToRename(null);
				}}
			/>
			<MoveProjectDialog
				project={toMove}
				onOpenChange={(open) => {
					if (!open) setToMove(null);
				}}
			/>
			<AlertDialog
				open={toRemove !== null}
				onOpenChange={(open) => {
					if (!open) setToRemove(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Remove {toRemove?.name} from Night Shift?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Night Shift forgets the project and its runs. The repository at{" "}
							<span className="font-mono">
								{toRemove ? projectFolder(toRemove) : null}
							</span>{" "}
							stays as it is.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={removeProject.isPending}
							onClick={() => {
								if (toRemove) removeProject.mutate({ projectId: toRemove.id });
							}}
						>
							{removeProject.isPending ? (
								<Spinner data-icon="inline-start" />
							) : null}
							{removeProject.isPending ? "Removing…" : "Remove project"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function ProjectCard({
	project,
	runs,
	removing,
	onRemove,
	onRename,
	onMove,
}: {
	project: Project;
	/** This project's runs, when loaded. */
	runs: RunSummary[] | undefined;
	removing: boolean;
	onRemove: () => void;
	onRename: () => void;
	onMove: () => void;
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
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`Actions for ${project.name}`}
									className="text-muted-foreground"
								/>
							}
						>
							<MoreHorizontalIcon />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-44">
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
							<DropdownMenuItem onClick={onRename}>
								<PencilIcon aria-hidden="true" />
								Rename…
							</DropdownMenuItem>
							<DropdownMenuItem onClick={onMove}>
								<ArrowRightLeftIcon aria-hidden="true" />
								Move to Space…
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								disabled={removing}
								aria-label={`Remove ${project.name}`}
								onClick={onRemove}
							>
								<Trash2Icon aria-hidden="true" />
								Remove project
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
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
