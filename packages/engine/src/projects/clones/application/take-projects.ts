import type { SpaceProjects, TakenProjects } from "../../keep";

export type TakeProjectsPorts = {
	spaceProjects: Pick<SpaceProjects, "take">;
};

/** The Space, and what it takes. */
export type TakeProjects = { spaceId: string; taken: TakenProjects };

/**
 * Takes projects into the Space's document, in one change: new entries,
 * removed projects back, and a Device's Clones. A Space a Host keeps is
 * left alone: only that Host changes it.
 */
export const takeProjects =
	(ports: TakeProjectsPorts) =>
	async (request: TakeProjects): Promise<void> =>
		ports.spaceProjects.take(request.spaceId, request.taken);
