import { Button } from "@nightshift/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { ZapIcon } from "lucide-react";
import { useState } from "react";

import { FlowHealth } from "@/components/dashboard/flow-health";
import { NeedsYou } from "@/components/dashboard/needs-you";
import { NightOutput } from "@/components/dashboard/night-output";
import { ProjectClones } from "@/components/dashboard/project-clones";
import { RunOutcomes } from "@/components/dashboard/run-outcomes";
import { UpNext } from "@/components/dashboard/up-next";
import { QuickRunDialog } from "@/components/new-run-form";
import { PageHeading } from "@/components/page-heading";
import { ProjectPage } from "@/components/project-page";
import { SectionCards } from "@/components/section-cards";
import { useProjectRuns } from "@/hooks/use-project-runs";
import { projectFolder } from "@/lib/projects";

export const Route = createFileRoute("/projects/$projectId/")({
	component: ProjectDashboardComponent,
});

/**
 * The project's root: a morning review. What needs you, what the night made,
 * what comes next, and how the flows do. Flows, runs and schedules have their
 * own pages.
 */
function ProjectDashboardComponent() {
	const { projectId } = Route.useParams();
	const runs = useProjectRuns(projectId);
	const [quickRun, setQuickRun] = useState(false);

	return (
		<ProjectPage projectId={projectId}>
			{(project) => (
				<>
					<PageHeading
						title={project.name}
						description={
							<span
								className="block truncate font-mono"
								title={projectFolder(project)}
							>
								{projectFolder(project)}
							</span>
						}
						actions={
							<Button
								variant="outline"
								size="sm"
								onClick={() => setQuickRun(true)}
							>
								<ZapIcon data-icon="inline-start" />
								Quick run
							</Button>
						}
					/>

					<NeedsYou projectId={project.id} />

					<SectionCards
						runs={runs.data}
						isLoading={runs.isLoading}
						project={project}
					/>

					<div className="grid gap-4 lg:grid-cols-3 lg:items-start">
						<NightOutput
							projectId={project.id}
							runs={runs.data}
							isLoading={runs.isLoading}
							onQuickRun={() => setQuickRun(true)}
							className="lg:col-span-2"
						/>
						<div className="flex flex-col gap-4">
							<UpNext projectId={project.id} runs={runs.data} />
							<RunOutcomes runs={runs.data} />
						</div>
					</div>

					<FlowHealth projectId={project.id} runs={runs.data} />

					<ProjectClones project={project} />

					<QuickRunDialog
						projectId={project.id}
						open={quickRun}
						onOpenChange={setQuickRun}
					/>
				</>
			)}
		</ProjectPage>
	);
}
