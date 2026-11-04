import { createFileRoute } from "@tanstack/react-router";

import { KnowledgeSourcesPage } from "@/features/knowledge";

export const Route = createFileRoute("/projects/$projectId/knowledge/sources")({
	component: KnowledgeSourcesPage,
});
