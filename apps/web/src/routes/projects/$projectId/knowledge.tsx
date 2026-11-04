import { createFileRoute, Outlet } from "@tanstack/react-router";

import { KnowledgeLayout } from "@/features/knowledge";

export const Route = createFileRoute("/projects/$projectId/knowledge")({
	component: KnowledgeRoute,
});

function KnowledgeRoute() {
	const { projectId } = Route.useParams();
	return (
		<KnowledgeLayout projectId={projectId}>
			<Outlet />
		</KnowledgeLayout>
	);
}
