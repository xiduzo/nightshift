import { createFileRoute } from "@tanstack/react-router";

import { SchedulesPrototype } from "@/features/prototype-schedules";

export const Route = createFileRoute("/projects/$projectId/schedules")({
	// PROTOTYPE: `?variant=` picks a Schedules page variant.
	validateSearch: (search: Record<string, unknown>): { variant?: string } => ({
		variant: typeof search.variant === "string" ? search.variant : undefined,
	}),
	component: ProjectSchedulesRoute,
});

function ProjectSchedulesRoute() {
	const { projectId } = Route.useParams();
	const { variant } = Route.useSearch();
	return <SchedulesPrototype projectId={projectId} variant={variant} />;
}
