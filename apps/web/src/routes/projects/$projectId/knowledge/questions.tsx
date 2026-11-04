import { createFileRoute } from "@tanstack/react-router";

import { KnowledgeQuestionsPage } from "@/features/knowledge";

export const Route = createFileRoute(
	"/projects/$projectId/knowledge/questions",
)({
	component: KnowledgeQuestionsPage,
});
