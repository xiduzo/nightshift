import { Button } from "@nightshift/ui/components/button";
import { createFileRoute } from "@tanstack/react-router";
import { ZapIcon } from "lucide-react";
import { useState } from "react";
import {
	FlowHealth,
	NightOutput,
	ProjectClones,
	RunOutcomes,
	SectionCards,
	UpNext,
} from "@/features/dashboard";
import { ProjectPage, projectFolder } from "@/features/projects";
import { QuickRunDialog, useProjectRuns } from "@/features/runs";
import { PageHeading } from "@/shared/page";

export const Route = createFileRoute("/projects/$projectId/")({
	component: ProjectDashboardComponent,
});

/**
 * The project's root: a morning review. What the night made, what comes next,
 * and how the flows do. Open Gates wait in the Inbox. Flows, runs and
 * schedules have their own pages.
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

					<FlowHealth project={project} runs={runs.data} />

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
