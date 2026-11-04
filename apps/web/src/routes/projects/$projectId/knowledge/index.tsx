import { createFileRoute } from "@tanstack/react-router";

import { KnowledgeOverviewPage } from "@/features/knowledge";

export const Route = createFileRoute("/projects/$projectId/knowledge/")({
	component: KnowledgeOverviewPage,
});
