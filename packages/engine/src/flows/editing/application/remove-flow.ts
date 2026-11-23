import type { Permissions } from "@nightshift/auth";
import type { Actor } from "../../../contract";
import type { FlowEditingAccess, SavedFlows, SpaceProjects } from "./ports";

const REMOVES_FLOWS: Permissions = { flow: ["remove"] };

export type RemoveFlowPorts = {
	access: FlowEditingAccess;
	projects: SpaceProjects;
	flows: Pick<SavedFlows, "remove">;
};

/**
 * Removes a flow of a project of the Space. Its revisions stay.
 */
export const removeFlow =
	(ports: RemoveFlowPorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			name: string;
		},
	): Promise<void> => {
		await ports.access.openSpace(actor, {
			spaceId: request.spaceId,
			need: REMOVES_FLOWS,
		});
		await ports.projects.inSpace(request.projectId, request.spaceId);
		await ports.flows.remove(request.projectId, request.name);
	};
