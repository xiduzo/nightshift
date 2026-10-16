import { createFileRoute } from "@tanstack/react-router";

import { FlowList } from "@/components/flow-list";
import { ProjectPage } from "@/components/project-page";

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
