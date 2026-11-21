import type { Actor } from "../../../contract";
import {
	checkSecret,
	type ProjectSecrets,
	type Reach,
	reachProjects,
} from "../../scopes";

export type SaveSpaceSecretPorts = {
	projects: Reach<Pick<ProjectSecrets, "space">>;
};

/** The Space, the secret, and the Person who saves it. */
export type SaveSpaceSecret = {
	spaceId: string;
	name: string;
	value: string;
	personId: string;
};

/**
 * Saves or replaces a Space secret, as `personId`: the keeper checks that
 * their role saves Flows, so the actor is not read.
 */
export const saveSpaceSecret =
	(ports: SaveSpaceSecretPorts) =>
	async (
		_actor: Actor,
		{ spaceId, name, value, personId }: SaveSpaceSecret,
	): Promise<void> => {
		checkSecret(name, value);
		await reachProjects(ports.projects).space.set(
			spaceId,
			name,
			value,
			personId,
		);
	};
