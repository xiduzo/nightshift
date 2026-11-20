import type { ProjectStore } from "../../keep";

export type FindClonePathPorts = {
	store: Pick<ProjectStore, "clonePath">;
};

/** The project, in its Space. */
export type FindClonePath = { projectId: string; spaceId: string };

/**
 * The folder of the project's Clone on this computer, or null: none here,
 * a project a person removed, or a project of another Space.
 */
export const findClonePath =
	(ports: FindClonePathPorts) =>
	async (request: FindClonePath): Promise<string | null> =>
		ports.store.clonePath(request.projectId, request.spaceId);
