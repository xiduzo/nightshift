import type { MovingProject, ProjectStore } from "../../keep";

export type MatchProjectsPorts = {
	store: Pick<ProjectStore, "matching">;
};

/** The ids and the remotes to find. */
export type MatchProjects = {
	ids?: readonly string[];
	remotes?: readonly string[];
};

/**
 * The projects of this Replica with one of `ids` or one of `remotes`, in
 * any Space, removed ones too: what a Host reads before it takes the
 * Projects of a Device's personal Space.
 */
export const matchProjects =
	(ports: MatchProjectsPorts) =>
	async (request: MatchProjects): Promise<MovingProject[]> =>
		ports.store.matching(request);
