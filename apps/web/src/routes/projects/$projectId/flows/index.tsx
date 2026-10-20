import { createFileRoute } from "@tanstack/react-router";

import { ProjectFlowsPage } from "@/features/flows";

export const Route = createFileRoute("/projects/$projectId/flows/")({
	component: ProjectFlowsRoute,
});

function ProjectFlowsRoute() {
	const { projectId } = Route.useParams();
	return <ProjectFlowsPage projectId={projectId} />;
}
