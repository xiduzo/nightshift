import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FolderGitIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { AddProjectForm } from "@/components/add-project-form";
import { RunList } from "@/components/run-list";
import type { Project } from "@/lib/api-types";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/")({
	component: HomeComponent,
});

const RECENT_RUNS = 20;

function HomeComponent() {
	const projects = useQuery(orpc.projects.list.queryOptions());
	const runs = useQuery(orpc.runs.list.queryOptions({ input: {} }));

	const recentRuns = runs.data
		?.slice()
		.sort((a, b) => b.createdAt - a.createdAt)
		.slice(0, RECENT_RUNS);

	return (
		<main className="min-h-0 overflow-y-auto">
			<div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 lg:grid-cols-2">
				<section
					aria-labelledby="projects-heading"
					className="flex flex-col gap-4"
				>
					<h1 id="projects-heading" className="font-medium text-sm">
						Projects
					</h1>
					<ProjectList
						projects={projects.data}
						isLoading={projects.isLoading}
					/>
					<div className="border p-3">
						<h2 className="mb-3 font-medium text-xs">Add project</h2>
						<AddProjectForm />
					</div>
				</section>
				<section aria-labelledby="runs-heading" className="flex flex-col gap-4">
					<h2 id="runs-heading" className="font-medium text-sm">
						Recent runs
					</h2>
					<RunList
						runs={recentRuns}
						projects={projects.data}
						isLoading={runs.isLoading}
						emptyDescription="Open a project and start a run. It shows up here."
					/>
				</section>
			</div>
		</main>
	);
}

function ProjectList({
	projects,
	isLoading,
}: {
	projects: Project[] | undefined;
	isLoading: boolean;
}) {
	const queryClient = useQueryClient();
	const removeProject = useMutation(
		orpc.projects.remove.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({ queryKey: orpc.projects.key() });
				void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (isLoading) {
		return (
			<div className="flex flex-col gap-1.5">
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
			</div>
		);
	}

	if (!projects || projects.length === 0) {
		return (
			<Empty className="border p-6 md:p-6">
				<EmptyHeader>
					<EmptyTitle>No projects yet</EmptyTitle>
					<EmptyDescription>
						Add a git repository below. Each run gets its own worktree in it.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<ul className="flex flex-col divide-y border">
			{projects.map((project) => (
				<li key={project.id} className="flex items-center gap-2 pr-2">
					<Link
						to="/projects/$projectId"
						params={{ projectId: project.id }}
						className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 outline-none hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring"
					>
						<FolderGitIcon
							className="size-4 shrink-0 text-muted-foreground"
							aria-hidden="true"
						/>
						<span className="flex min-w-0 flex-col">
							<span className="truncate font-medium text-sm">
								{project.name}
							</span>
							<span className="truncate font-mono text-muted-foreground text-xs">
								{project.repoPath}
							</span>
						</span>
					</Link>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Remove ${project.name}`}
						title="Remove project"
						disabled={removeProject.isPending}
						onClick={() => {
							if (window.confirm(`Remove ${project.name} from Night Shift?`)) {
								removeProject.mutate({ projectId: project.id });
							}
						}}
					>
						<Trash2Icon />
					</Button>
				</li>
			))}
		</ul>
	);
}
