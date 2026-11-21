import type { Actor } from "../../../contract";
import { type ProjectSecrets, type Reach, reachProjects } from "../../scopes";

export type RemoveSpaceSecretPorts = {
	projects: Reach<Pick<ProjectSecrets, "space">>;
};

/** The Space, the secret, and the Person who removes it. */
export type RemoveSpaceSecret = {
	spaceId: string;
	name: string;
	personId: string;
};

/** Removes a Space secret, as `personId`: the keeper checks their role, so the actor is not read. */
export const removeSpaceSecret =
	(ports: RemoveSpaceSecretPorts) =>
	async (
		_actor: Actor,
		{ spaceId, name, personId }: RemoveSpaceSecret,
	): Promise<void> => {
		await reachProjects(ports.projects).space.remove(spaceId, name, personId);
	};
