import type { Actor } from "../../../contract";
import {
	type ProjectSecretName,
	type ProjectSecrets,
	type Reach,
	reachProjects,
} from "../../scopes";

export type ListSpaceSecretsPorts = {
	projects: Reach<Pick<ProjectSecrets, "space">>;
};

/** The Space, and the Person the keeper lists the names to. */
export type ListSpaceSecrets = { spaceId: string; personId: string };

/**
 * The secrets of a Space (ADR 18), as `personId` may see them: names,
 * when each was set and by whom. Throws when they cannot be read now. The
 * keeper checks the Person: the actor is not read.
 */
export const listSpaceSecrets =
	(ports: ListSpaceSecretsPorts) =>
	async (
		_actor: Actor,
		{ spaceId, personId }: ListSpaceSecrets,
	): Promise<ProjectSecretName[]> =>
		reachProjects(ports.projects).space.list(spaceId, personId);
