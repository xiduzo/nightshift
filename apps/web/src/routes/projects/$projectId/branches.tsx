import { createFileRoute } from "@tanstack/react-router";

import { ProjectRunCopiesPage, preloadRunCopiesPage } from "@/features/runs";

export const Route = createFileRoute("/projects/$projectId/branches")({
	loader: ({ context, params }) =>
		preloadRunCopiesPage(context.queryClient, params.projectId),
	component: ProjectBranchesRoute,
});

function ProjectBranchesRoute() {
	const { projectId } = Route.useParams();
	return <ProjectRunCopiesPage projectId={projectId} />;
}
