import { type LoadedFlow, loadFlowSource } from "@nightshift/flows";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { ProjectFlows } from "../../store";
import type { SpaceProjects } from "./ports";

export type ReadFlowPorts = {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "flows">;
};

/**
 * One flow of a project of the Space, with its problems.
 * A Member of the Space may, whatever the role (`access.openSpace`).
 */
export const readFlow =
	(ports: ReadFlowPorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			name: string;
		},
	): Promise<LoadedFlow> => {
		await ports.access.openSpace(actor, { spaceId: request.spaceId });
		await ports.projects.inSpace(request.projectId, request.spaceId);
		return loadFlowSource(
			await ports.flows.flows(request.projectId),
			request.name,
		);
	};
