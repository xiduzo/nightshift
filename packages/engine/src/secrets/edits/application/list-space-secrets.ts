import type { Access } from "../../../access";
import type { PersonActor } from "../../../contract";
import {
	type ProjectSecretName,
	type ProjectSecrets,
	type Reach,
	reachProjects,
} from "../../scopes";

export type ListSpaceSecretsPorts = {
	access: Pick<Access, "openSpace">;
	projects: Reach<Pick<ProjectSecrets, "space">>;
};

/** The Space. */
export type ListSpaceSecrets = { spaceId: string };

/**
 * The secrets of a Space (ADR 18), as the Person who asks may see them:
 * names, when each was set and by whom. Throws when they cannot be read
 * now. A Member of the Space may, whatever the role.
 */
export const listSpaceSecrets =
	(ports: ListSpaceSecretsPorts) =>
	async (
		actor: PersonActor,
		{ spaceId }: ListSpaceSecrets,
	): Promise<ProjectSecretName[]> => {
		await ports.access.openSpace(actor, { spaceId });
		return reachProjects(ports.projects).space.list(spaceId, actor.personId);
	};
