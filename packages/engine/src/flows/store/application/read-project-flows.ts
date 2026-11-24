import type { FlowSources } from "@nightshift/flows";
import type { FlowStore, ProjectSpaces } from "./ports";

export type ReadProjectFlowsPorts = {
	store: Pick<FlowStore, "read">;
	projects: ProjectSpaces;
};

/**
 * Every flow of the project by name, as it is stored, with its Flow
 * revision. Refuses (`not-found`) a Project this Replica does not have.
 */
export const readProjectFlows =
	(ports: ReadProjectFlowsPorts) =>
	async (request: { projectId: string }): Promise<FlowSources> => {
		await ports.projects.spaceOf(request.projectId);
		return ports.store.read(request.projectId);
	};
