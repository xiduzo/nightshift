import { createFileRoute } from "@tanstack/react-router";

import { KnowledgeReviewPage } from "@/features/knowledge";

export const Route = createFileRoute("/projects/$projectId/knowledge/review")({
	component: KnowledgeReviewPage,
});
