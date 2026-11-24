import { type FlowListItem, listFlowSources } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import type { ProjectFlows } from "../../store";
import type { SpaceProjects } from "./ports";

export type ListFlowsPorts = {
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "flows">;
};

/**
 * The flows of a project of the Space, from its flow document: every
 * Device has them, with or without a Clone.
 */
export const listFlows =
	(ports: ListFlowsPorts) =>
	async (
		_actor: Actor,
		request: { spaceId: string; projectId: string },
	): Promise<FlowListItem[]> => {
		await ports.projects.inSpace(request.projectId, request.spaceId);
		return listFlowSources(await ports.flows.flows(request.projectId));
	};
