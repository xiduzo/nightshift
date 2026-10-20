import { createFileRoute } from "@tanstack/react-router";

import { ProjectPage } from "@/features/projects";
import { ScheduleList } from "@/features/schedules";

export const Route = createFileRoute("/projects/$projectId/schedules")({
	component: ProjectSchedulesComponent,
});

function ProjectSchedulesComponent() {
	const { projectId } = Route.useParams();
	return (
		<ProjectPage projectId={projectId} section="Schedules">
			{(project) => <ScheduleList projectId={project.id} />}
		</ProjectPage>
	);
}
