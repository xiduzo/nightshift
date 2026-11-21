import { secretNameSchema } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import {
	movedValue,
	type ProjectSecrets,
	type Reach,
	reachProjects,
	removeIn,
	type SecretScope,
	valueIn,
} from "../../scopes";
import type { ScopePorts } from "./save-secret";

export type MoveSecretToSpacePorts = ScopePorts & {
	projects: Reach<Pick<ProjectSecrets, "space">>;
};

/** The secret, the scope it moves from, the Space, and the Person who moves it. */
export type MoveSecretToSpace = {
	name: string;
	from: SecretScope;
	spaceId: string;
	personId: string;
};

/**
 * Moves a saved secret of this computer, or a Personal one, into a Space:
 * it is saved in the Space first, then the copy it moved from goes. The
 * keeper checks the Person's role, so the actor is not read.
 */
export const moveSecretToSpace =
	(ports: MoveSecretToSpacePorts) =>
	async (
		_actor: Actor,
		{ name, from, spaceId, personId }: MoveSecretToSpace,
	): Promise<void> => {
		secretNameSchema.parse(name);
		const value = movedValue(await valueIn(ports, from, name), from, name);
		// Saved in the Space first: a failure there keeps this copy.
		await reachProjects(ports.projects).space.set(
			spaceId,
			name,
			value,
			personId,
		);
		await removeIn(ports, from, name);
	};
