import type { FlowRevision } from "../domain/flow-json";
import type { FlowStore, ProjectSpaces } from "./ports";

export type ListProjectFlowRevisionsPorts = {
	store: Pick<FlowStore, "revisions">;
	projects: ProjectSpaces;
};

/**
 * The revisions of the flow of that name, oldest first. Empty for a flow
 * that does not exist. A revision of an older format reads as the Device
 * that saved it named its profiles and Devices.
 */
export const listProjectFlowRevisions =
	(ports: ListProjectFlowRevisionsPorts) =>
	async (request: {
		projectId: string;
		name: string;
	}): Promise<FlowRevision[]> => {
		const spaceId = await ports.projects.spaceOf(request.projectId);
		return ports.store.revisions(request.projectId, request.name, spaceId);
	};
