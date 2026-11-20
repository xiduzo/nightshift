import type { FlowSources } from "@nightshift/flows";
import type { FlowStore, ProjectSpaces, ThisDevice } from "./ports";

export type ReadProjectFlowsPorts = {
	store: Pick<FlowStore, "read">;
	projects: ProjectSpaces;
	device: ThisDevice;
};

/**
 * Every flow of the project that Night Shift reads, by name, with its Flow
 * revision. A flow of an older format reads as the Device that saved it
 * named its profiles and Devices. Refuses (`not-found`) a Project this
 * Replica does not have.
 */
export const readProjectFlows =
	(ports: ReadProjectFlowsPorts) =>
	async (request: { projectId: string }): Promise<FlowSources> => {
		const spaceId = await ports.projects.spaceOf(request.projectId);
		const deviceId = await ports.device.id();
		return ports.store.read(request.projectId, { deviceId, spaceId });
	};
