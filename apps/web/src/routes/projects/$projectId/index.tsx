import { createFileRoute } from "@tanstack/react-router";

import {
	PAGE_RANGES,
	ProjectDashboardPage,
	preloadProjectDashboardPage,
} from "@/features/dashboard";

export const Route = createFileRoute("/projects/$projectId/")({
	// The page's range, so a link or a reload keeps it: `?range=30`.
	validateSearch: (
		search: Record<string, unknown>,
	): { range?: (typeof PAGE_RANGES)[number] } => ({
		range: PAGE_RANGES.find(
			(nights) => String(nights) === String(search.range),
		),
	}),
	loader: ({ context, params }) =>
		preloadProjectDashboardPage(context.queryClient, params.projectId),
	component: ProjectDashboardRoute,
});

function ProjectDashboardRoute() {
	const { projectId } = Route.useParams();
	const { range = 7 } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<ProjectDashboardPage
			projectId={projectId}
			range={range}
			onRangeChange={(next) =>
				void navigate({ search: { range: next }, replace: true })
			}
		/>
	);
}
