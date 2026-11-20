import type { ListedProject, ProjectStore } from "../../keep";

export type ListSpaceProjectsPorts = {
	store: Pick<ProjectStore, "listInSpace">;
};

/** The Space. Without one, every Space. */
export type ListSpaceProjects = { spaceId?: string };

/**
 * Every project of the Space a person has not removed, oldest first,
 * also those without a Clone on this computer (`repoPath` null). Without a
 * Space, every Space's: the scheduler's.
 */
export const listSpaceProjects =
	(ports: ListSpaceProjectsPorts) =>
	async (request: ListSpaceProjects): Promise<ListedProject[]> =>
		ports.store.listInSpace(request.spaceId);
