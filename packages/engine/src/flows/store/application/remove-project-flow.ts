import type { FlowStore, ProjectSpaces } from "./ports";

export type RemoveProjectFlowPorts = {
	store: Pick<FlowStore, "remove">;
	projects: ProjectSpaces;
};

/** Removes a flow. Its revisions stay. Refuses (`not-found`) a flow or a Project that does not exist. */
export const removeProjectFlow =
	(ports: RemoveProjectFlowPorts) =>
	async (request: { projectId: string; name: string }): Promise<void> => {
		await ports.projects.spaceOf(request.projectId);
		await ports.store.remove(request.projectId, request.name);
	};
