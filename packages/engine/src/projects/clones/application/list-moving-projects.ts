import type { MovingProject, ProjectStore } from "../../keep";

export type ListMovingProjectsPorts = {
	store: Pick<ProjectStore, "ofSpace">;
};

/** The Space. */
export type ListMovingProjects = { spaceId: string };

/**
 * The projects of a Space, removed ones too, oldest first, with whether
 * this computer has a Clone of each and walked a run of it in the Space:
 * what a Device asks its home Host to take when its personal Space
 * merges into the Host's, and what a split takes along.
 */
export const listMovingProjects =
	(ports: ListMovingProjectsPorts) =>
	async (
		request: ListMovingProjects,
	): Promise<(MovingProject & { clone: boolean; walked: boolean })[]> =>
		ports.store.ofSpace(request.spaceId);
