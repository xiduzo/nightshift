import { createFileRoute } from "@tanstack/react-router";

import { ProjectSchedulesPage } from "@/features/schedules";

export const Route = createFileRoute("/projects/$projectId/schedules")({
	component: ProjectSchedulesRoute,
});

function ProjectSchedulesRoute() {
	const { projectId } = Route.useParams();
	return <ProjectSchedulesPage projectId={projectId} />;
}
