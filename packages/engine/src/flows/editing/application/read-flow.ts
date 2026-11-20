import { type LoadedFlow, loadFlowSource } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import type { SavedFlows, SpaceProjects } from "./ports";

export type ReadFlowPorts = {
	projects: SpaceProjects;
	flows: Pick<SavedFlows, "flows">;
};

/**
 * One flow of a project of the Space, with its problems.
 */
export const readFlow =
	(ports: ReadFlowPorts) =>
	async (
		_actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			name: string;
		},
	): Promise<LoadedFlow> => {
		await ports.projects.inSpace(request.projectId, request.spaceId);
		return loadFlowSource(
			await ports.flows.flows(request.projectId),
			request.name,
		);
	};
