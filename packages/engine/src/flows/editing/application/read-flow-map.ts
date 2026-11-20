import { type ProjectFlowMap, parsedFlows } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import type { SavedFlows, SpaceProjects } from "./ports";

export type ReadFlowMapPorts = {
	projects: SpaceProjects;
	flows: Pick<SavedFlows, "flows">;
};

/**
 * Every flow of a project of the Space by name: its flow, null when it
 * does not load. One read for the editor.
 */
export const readFlowMap =
	(ports: ReadFlowMapPorts) =>
	async (
		_actor: Actor,
		request: { spaceId: string; projectId: string },
	): Promise<ProjectFlowMap> => {
		await ports.projects.inSpace(request.projectId, request.spaceId);
		return parsedFlows(await ports.flows.flows(request.projectId));
	};
