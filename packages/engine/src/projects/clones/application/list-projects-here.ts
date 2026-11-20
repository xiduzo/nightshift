import type { ProjectRow, ProjectStore } from "../../keep";

export type ListProjectsHerePorts = {
	store: Pick<ProjectStore, "here">;
};

/** The Space. Without one, every Space. */
export type ListProjectsHere = { spaceId?: string };

/**
 * The projects with a Clone here a person has not removed, oldest first:
 * the Space's, or without a Space every Space's.
 */
export const listProjectsHere =
	(ports: ListProjectsHerePorts) =>
	async (request: ListProjectsHere): Promise<ProjectRow[]> =>
		ports.store.here(
			request.spaceId === undefined
				? { kept: true }
				: { kept: true, spaceId: request.spaceId },
		);
