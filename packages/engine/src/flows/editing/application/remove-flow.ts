import type { Actor } from "../../../contract";
import type { SavedFlows, SpaceProjects } from "./ports";

export type RemoveFlowPorts = {
	projects: SpaceProjects;
	flows: Pick<SavedFlows, "remove">;
};

/**
 * Removes a flow of a project of the Space. Its revisions stay.
 */
export const removeFlow =
	(ports: RemoveFlowPorts) =>
	async (
		_actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			name: string;
		},
	): Promise<void> => {
		await ports.projects.inSpace(request.projectId, request.spaceId);
		await ports.flows.remove(request.projectId, request.name);
	};
