import { createFileRoute } from "@tanstack/react-router";

import { ProjectRunsPage } from "@/features/runs";

export const Route = createFileRoute("/projects/$projectId/runs")({
	component: ProjectRunsRoute,
});

function ProjectRunsRoute() {
	const { projectId } = Route.useParams();
	return <ProjectRunsPage projectId={projectId} />;
}
