import type { ProjectSecretStore, SpaceSecretStore } from "../../kept";
import type { ProjectAt } from "../domain/project-secrets";
import type { KeeperSpaces } from "./ports";

export type ListKeptValuesPorts = {
	spaces: KeeperSpaces;
	store: Pick<ProjectSecretStore, "values">;
	spaceStore: Pick<SpaceSecretStore, "values">;
};

/** The Project, and the names (every one without names). */
export type ListKeptValues = {
	project: ProjectAt;
	names?: readonly string[] | undefined;
};

/**
 * The values of a Project's and its Space's secrets that this computer
 * keeps, the Space's first: none for a Space a Host keeps.
 *
 * Night Shift asks: the use case takes the request alone.
 */
export const listKeptValues =
	(ports: ListKeptValuesPorts) =>
	async (request: ListKeptValues): Promise<string[]> => {
		const { project: at, names } = request;
		if ((await ports.spaces.hostOf(at.spaceId)) !== null) return [];
		return [
			...Object.values(await ports.spaceStore.values(at.spaceId, names)),
			...Object.values(await ports.store.values(at.projectId, names)),
		];
	};
