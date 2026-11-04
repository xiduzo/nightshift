import { createFileRoute } from "@tanstack/react-router";

import { KnowledgeFilesPage } from "@/features/knowledge";

export const Route = createFileRoute("/projects/$projectId/knowledge/files")({
	component: KnowledgeFilesPage,
});
