import { createFileRoute } from "@tanstack/react-router";

import { ProjectPage } from "@/components/project-page";
import { ScheduleList } from "@/components/schedule/schedule-list";

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
