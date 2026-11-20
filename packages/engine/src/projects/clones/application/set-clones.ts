import { Refusal } from "@nightshift/refusal";
import { PROJECT_NOT_FOUND, type SpaceProjects } from "../../keep";

export type SetClonesPorts = {
	spaceProjects: Pick<SpaceProjects, "setClones">;
};

/** The Space, the Device, and the projects it says it has. */
export type SetClones = {
	spaceId: string;
	deviceId: string;
	deviceName: string;
	projectIds: readonly string[];
};

/**
 * Makes a Device's Clones in the Space's document exactly the projects it
 * says it has, on the Host that keeps the Space. A project the document
 * lacks is left out, and so is one without a folder. In step, the
 * document does not change. Not found when this Replica does not keep the
 * Space.
 */
export const setClones =
	(ports: SetClonesPorts) =>
	async (
		request: SetClones,
	): Promise<{ added: string[]; removed: string[] }> => {
		const { spaceId, ...input } = request;
		const changed = await ports.spaceProjects.setClones(spaceId, input);
		if (!changed) throw new Refusal("not-found", PROJECT_NOT_FOUND);
		return changed;
	};
