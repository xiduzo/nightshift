import { createFileRoute } from "@tanstack/react-router";

import { type KnowledgeTab, ProjectKnowledgePage } from "@/features/knowledge";

const TABS: readonly KnowledgeTab[] = ["review", "knows", "map"];

export const Route = createFileRoute("/projects/$projectId/knowledge")({
	validateSearch: (
		search: Record<string, unknown>,
	): { tab?: KnowledgeTab; node?: string } => ({
		...(TABS.includes(search.tab as KnowledgeTab)
			? { tab: search.tab as KnowledgeTab }
			: {}),
		...(typeof search.node === "string" ? { node: search.node } : {}),
	}),
	component: ProjectKnowledgeRoute,
});

function ProjectKnowledgeRoute() {
	const { projectId } = Route.useParams();
	const { tab, node } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<ProjectKnowledgePage
			projectId={projectId}
			tab={tab}
			node={node}
			onView={(search) => void navigate({ search, replace: true })}
		/>
	);
}
