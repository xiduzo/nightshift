import { ProjectPage } from "@/features/projects";

import { ScheduleList } from "./schedule-list";

/** A project's Schedules page: when its flows run on their own. */
export function ProjectSchedulesPage({ projectId }: { projectId: string }) {
	return (
		<ProjectPage projectId={projectId} section="Schedules">
			{(project) => <ScheduleList projectId={project.id} />}
		</ProjectPage>
	);
}
