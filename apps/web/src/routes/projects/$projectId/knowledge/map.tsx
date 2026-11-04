import { createFileRoute } from "@tanstack/react-router";

import { KnowledgeMapPage } from "@/features/knowledge";

export const Route = createFileRoute("/projects/$projectId/knowledge/map")({
	// `node`: the node to start from.
	validateSearch: (search: Record<string, unknown>): { node?: string } =>
		typeof search.node === "string" ? { node: search.node } : {},
	component: KnowledgeMapRoute,
});

function KnowledgeMapRoute() {
	const { node } = Route.useSearch();
	return <KnowledgeMapPage node={node} />;
}
