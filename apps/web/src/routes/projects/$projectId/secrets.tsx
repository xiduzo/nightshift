import { createFileRoute } from "@tanstack/react-router";

import { ProjectSecretsPage } from "@/features/agents";

export const Route = createFileRoute("/projects/$projectId/secrets")({
	component: ProjectSecretsRoute,
});

function ProjectSecretsRoute() {
	const { projectId } = Route.useParams();
	return <ProjectSecretsPage projectId={projectId} />;
}
