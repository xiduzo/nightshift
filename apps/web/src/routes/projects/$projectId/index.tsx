import { createFileRoute } from "@tanstack/react-router";

import {
	ProjectDashboardPage,
	preloadProjectDashboardPage,
} from "@/features/dashboard";

export const Route = createFileRoute("/projects/$projectId/")({
	// PROTOTYPE: `?variant=` picks a dashboard variant, `?range=` the page-wide range.
	validateSearch: (
		search: Record<string, unknown>,
	): { variant?: string; range?: string } => ({
		variant: typeof search.variant === "string" ? search.variant : undefined,
		range:
			typeof search.range === "string" || typeof search.range === "number"
				? String(search.range)
				: undefined,
	}),
	loader: ({ context, params }) =>
		preloadProjectDashboardPage(context.queryClient, params.projectId),
	component: ProjectDashboardRoute,
});

function ProjectDashboardRoute() {
	const { projectId } = Route.useParams();
	return <ProjectDashboardPage projectId={projectId} />;
}
