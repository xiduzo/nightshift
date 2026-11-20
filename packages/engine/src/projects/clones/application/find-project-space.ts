import type { ProjectStore } from "../../keep";

export type FindProjectSpacePorts = {
	store: Pick<ProjectStore, "row">;
};

/** The project. */
export type FindProjectSpace = { projectId: string };

/**
 * The Space of a project, a removed one too. Null for one this Replica
 * lacks.
 */
export const findProjectSpace =
	(ports: FindProjectSpacePorts) =>
	async (request: FindProjectSpace): Promise<string | null> => {
		const row = await ports.store.row(request.projectId);
		return row?.spaceId ?? null;
	};
