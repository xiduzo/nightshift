import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { FlowList } from "@/components/flow-list";
import { NewRunForm } from "@/components/new-run-form";
import { RunList } from "@/components/run-list";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/projects/$projectId/")({
	component: ProjectComponent,
});

function ProjectComponent() {
	const { projectId } = Route.useParams();
	const projects = useQuery(orpc.projects.list.queryOptions());
	const runs = useQuery(orpc.runs.list.queryOptions({ input: { projectId } }));
	const project = projects.data?.find((p) => p.id === projectId);

	if (projects.isLoading) {
		return (
			<main className="mx-auto w-full max-w-6xl px-4 py-6">
				<Skeleton className="h-10 w-80" />
			</main>
		);
	}

	if (!project) {
		return (
			<main className="mx-auto w-full max-w-6xl px-4 py-6">
				<Empty className="border">
					<EmptyHeader>
						<EmptyTitle>Project not found</EmptyTitle>
						<EmptyDescription>
							It may have been removed. <Link to="/">Back to projects</Link>
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</main>
		);
	}

	return (
		<main className="min-h-0 overflow-y-auto">
			<div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
				<header className="flex flex-col gap-0.5">
					<h1 className="font-medium text-base">{project.name}</h1>
					<p className="truncate font-mono text-muted-foreground text-xs">
						{project.repoPath}
					</p>
				</header>
				<div className="grid gap-8 lg:grid-cols-2">
					<div className="flex flex-col gap-8">
						<FlowList projectId={project.id} />
						<section
							aria-labelledby="new-run-heading"
							className="flex flex-col gap-3"
						>
							<div className="flex flex-col gap-0.5">
								<h2 id="new-run-heading" className="font-medium text-sm">
									Quick run
								</h2>
								<p className="text-muted-foreground text-xs">
									One Agent node with a prompt, no flow file.
								</p>
							</div>
							<div className="border p-3">
								<NewRunForm projectId={project.id} />
							</div>
						</section>
					</div>
					<section
						aria-labelledby="runs-heading"
						className="flex flex-col gap-3"
					>
						<h2 id="runs-heading" className="font-medium text-sm">
							Runs
						</h2>
						<RunList
							runs={runs.data}
							isLoading={runs.isLoading}
							emptyDescription="Run a flow or start a quick run. Each run works in its own worktree."
						/>
					</section>
				</div>
			</div>
		</main>
	);
}
