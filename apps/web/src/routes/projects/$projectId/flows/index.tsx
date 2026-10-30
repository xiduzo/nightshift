import { createFileRoute } from "@tanstack/react-router";

import { FlowsPrototype } from "@/features/prototype-flows";

export const Route = createFileRoute("/projects/$projectId/flows/")({
	// PROTOTYPE: `?variant=` picks a Flows page variant.
	validateSearch: (search: Record<string, unknown>): { variant?: string } => ({
		variant: typeof search.variant === "string" ? search.variant : undefined,
	}),
	component: ProjectFlowsRoute,
});

function ProjectFlowsRoute() {
	const { projectId } = Route.useParams();
	const { variant } = Route.useSearch();
	return <FlowsPrototype projectId={projectId} variant={variant} />;
}
