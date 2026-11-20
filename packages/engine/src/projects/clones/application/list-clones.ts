import type { SpaceProjects } from "../../keep";

export type ListClonesPorts = {
	spaceProjects: Pick<SpaceProjects, "clones">;
};

/** The project, in its Space. */
export type ListClones = { spaceId: string; projectId: string };

/**
 * The Devices with a Clone of the project, as its Space document says,
 * oldest Clone first.
 */
export const listClones =
	(ports: ListClonesPorts) =>
	async (
		request: ListClones,
	): Promise<{ deviceId: string; deviceName: string | null }[]> => {
		const clones = await ports.spaceProjects.clones(request.spaceId, [
			request.projectId,
		]);
		return clones.get(request.projectId) ?? [];
	};
