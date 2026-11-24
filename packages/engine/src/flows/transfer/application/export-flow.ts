import { loadFlowSource } from "@nightshift/flows";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { ProjectFlows } from "../../store";
import { type FlowExport, flowFile, notValidFlow } from "../domain/flow-files";
import type { SpaceProjects } from "./ports";

export type ExportFlowPorts = {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "flows">;
};

/**
 * The flow of a project of the Space as a JSON file, in the form Night
 * Shift saves it. Refuses a flow that is not valid.
 * A Member of the Space may, whatever the role (`access.openSpace`).
 */
export const exportFlow =
	(ports: ExportFlowPorts) =>
	async (
		actor: Actor,
		request: { spaceId: string; projectId: string; name: string },
	): Promise<FlowExport> => {
		await ports.access.openSpace(actor, { spaceId: request.spaceId });
		const { projectId, name } = request;
		await ports.projects.inSpace(projectId, request.spaceId);
		const loaded = loadFlowSource(await ports.flows.flows(projectId), name);
		if (loaded.flow === null) throw notValidFlow(name);
		return flowFile(name, loaded.flow);
	};
