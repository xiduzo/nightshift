import { type ProjectFlowMap, parsedFlows } from "@nightshift/flows";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { ProjectFlows } from "../../store";
import type { SpaceProjects } from "./ports";

export type ReadFlowMapPorts = {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "flows">;
};

/**
 * Every flow of a project of the Space by name: its flow, null when it
 * does not load. One read for the editor.
 * A Member of the Space may, whatever the role (`access.openSpace`).
 */
export const readFlowMap =
	(ports: ReadFlowMapPorts) =>
	async (
		actor: Actor,
		request: { spaceId: string; projectId: string },
	): Promise<ProjectFlowMap> => {
		await ports.access.openSpace(actor, { spaceId: request.spaceId });
		await ports.projects.inSpace(request.projectId, request.spaceId);
		return parsedFlows(await ports.flows.flows(request.projectId));
	};
