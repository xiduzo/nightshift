import { loadFlowSource } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import { type FlowExport, flowFile, notValidFlow } from "../domain/flow-files";
import type { SavedFlows, SpaceProjects } from "./ports";

export type ExportFlowPorts = {
	projects: SpaceProjects;
	flows: Pick<SavedFlows, "flows">;
};

/**
 * The flow of a project of the Space as a JSON file, in the form Night
 * Shift saves it. Refuses a flow that is not valid.
 */
export const exportFlow =
	(ports: ExportFlowPorts) =>
	async (
		_actor: Actor,
		request: { spaceId: string; projectId: string; name: string },
	): Promise<FlowExport> => {
		const { projectId, name } = request;
		await ports.projects.inSpace(projectId, request.spaceId);
		const loaded = loadFlowSource(await ports.flows.flows(projectId), name);
		if (loaded.flow === null) throw notValidFlow(name);
		return flowFile(name, loaded.flow);
	};
