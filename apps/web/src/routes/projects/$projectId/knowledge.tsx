import { createFileRoute } from "@tanstack/react-router";

import { ProjectKnowledgePage } from "@/features/knowledge";

export const Route = createFileRoute("/projects/$projectId/knowledge")({
	component: ProjectKnowledgeRoute,
});

function ProjectKnowledgeRoute() {
	const { projectId } = Route.useParams();
	return <ProjectKnowledgePage projectId={projectId} />;
}
