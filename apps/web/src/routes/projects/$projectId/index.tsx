import { createFileRoute } from "@tanstack/react-router";

import {
	ProjectDashboardPage,
	preloadProjectDashboardPage,
} from "@/features/dashboard";

export const Route = createFileRoute("/projects/$projectId/")({
	loader: ({ context, params }) =>
		preloadProjectDashboardPage(context.queryClient, params.projectId),
	component: ProjectDashboardRoute,
});

function ProjectDashboardRoute() {
	const { projectId } = Route.useParams();
	return <ProjectDashboardPage projectId={projectId} />;
}
