import { secretNameSchema } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import {
	movedValue,
	type ProjectSecrets,
	type Reach,
	reachProjects,
	type SecretScope,
	saveIn,
} from "../../scopes";
import type { ScopePorts } from "./save-secret";

export type MoveSecretFromSpacePorts = ScopePorts & {
	projects: Reach<Pick<ProjectSecrets, "space">>;
};

/** The Space, the secret, the scope it moves to, and the Person who moves it. */
export type MoveSecretFromSpace = {
	spaceId: string;
	name: string;
	to: SecretScope;
	personId: string;
};

/**
 * Moves a Space's secret to this computer, or to its owner's Personal
 * secrets. The Space's copy goes only after the new one is saved. The
 * keeper checks the Person's role, so the actor is not read.
 */
export const moveSecretFromSpace =
	(ports: MoveSecretFromSpacePorts) =>
	async (
		_actor: Actor,
		{ spaceId, name, to, personId }: MoveSecretFromSpace,
	): Promise<void> => {
		secretNameSchema.parse(name);
		const value = movedValue(
			await reachProjects(ports.projects).space.take(spaceId, name, personId),
			"space",
			name,
		);
		// Saved in its new scope first: a failure there keeps the Space's.
		await saveIn(ports, to, name, value);
		await reachProjects(ports.projects).space.remove(spaceId, name, personId);
	};
