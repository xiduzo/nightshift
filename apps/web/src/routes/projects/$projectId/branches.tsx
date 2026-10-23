import { createFileRoute } from "@tanstack/react-router";

import { ProjectRunCopiesPage } from "@/features/runs";

export const Route = createFileRoute("/projects/$projectId/branches")({
	component: ProjectBranchesRoute,
});

function ProjectBranchesRoute() {
	const { projectId } = Route.useParams();
	return <ProjectRunCopiesPage projectId={projectId} />;
}
