import { createFileRoute } from "@tanstack/react-router";

import { FlowList } from "@/features/flows";
import { ProjectPage } from "@/features/projects";

export const Route = createFileRoute("/projects/$projectId/flows/")({
	component: ProjectFlowsComponent,
});

function ProjectFlowsComponent() {
	const { projectId } = Route.useParams();
	return (
		<ProjectPage projectId={projectId} section="Flows">
			{(project) => <FlowList projectId={project.id} />}
		</ProjectPage>
	);
}
