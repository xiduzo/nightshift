import type { FlowRevision } from "../domain/flow-json";
import type { FlowStore, ProjectSpaces } from "./ports";

export type ListProjectFlowRevisionsPorts = {
	store: Pick<FlowStore, "revisions">;
	projects: ProjectSpaces;
};

/**
 * The revisions of the flow of that name, oldest first. Empty for a flow
 * that does not exist. The flow of a revision is as it was saved.
 */
export const listProjectFlowRevisions =
	(ports: ListProjectFlowRevisionsPorts) =>
	async (request: {
		projectId: string;
		name: string;
	}): Promise<FlowRevision[]> => {
		await ports.projects.spaceOf(request.projectId);
		return ports.store.revisions(request.projectId, request.name);
	};
