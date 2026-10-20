import { createFileRoute } from "@tanstack/react-router";

import { ProjectDashboardPage } from "@/features/dashboard";

export const Route = createFileRoute("/projects/$projectId/")({
	component: ProjectDashboardRoute,
});

function ProjectDashboardRoute() {
	const { projectId } = Route.useParams();
	return <ProjectDashboardPage projectId={projectId} />;
}
