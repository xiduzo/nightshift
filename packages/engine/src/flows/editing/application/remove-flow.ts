import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { ProjectFlows } from "../../store";
import type { SpaceProjects } from "./ports";

const REMOVES_FLOWS: Permissions = { flow: ["remove"] };

export type RemoveFlowPorts = {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "remove">;
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
