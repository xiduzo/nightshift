import { ProjectPage } from "@/features/projects";

import { FlowList } from "./flow-list";

/** A project's Flows page: its flows, to open, start or delete. */
export function ProjectFlowsPage({ projectId }: { projectId: string }) {
	return (
		<ProjectPage projectId={projectId} section="Flows">
			{(project) => <FlowList projectId={project.id} />}
		</ProjectPage>
	);
}
