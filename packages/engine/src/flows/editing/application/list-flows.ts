import { type FlowListItem, listFlowSources } from "@nightshift/flows";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { ProjectFlows } from "../../store";
import type { SpaceProjects } from "./ports";

export type ListFlowsPorts = {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "flows">;
};

/**
 * The flows of a project of the Space, from its flow document: every
 * Device has them, with or without a Clone.
 * A Member of the Space may, whatever the role (`access.openSpace`).
 */
export const listFlows =
	(ports: ListFlowsPorts) =>
	async (
		actor: Actor,
		request: { spaceId: string; projectId: string },
	): Promise<FlowListItem[]> => {
		await ports.access.openSpace(actor, { spaceId: request.spaceId });
		await ports.projects.inSpace(request.projectId, request.spaceId);
		return listFlowSources(await ports.flows.flows(request.projectId));
	};
