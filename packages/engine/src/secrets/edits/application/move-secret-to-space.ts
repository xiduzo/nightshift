import type { Permissions } from "@nightshift/auth";
import { secretNameSchema } from "@nightshift/flows";
import type { Access } from "../../../access";
import type { PersonActor } from "../../../contract";
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

const SAVES_FLOWS: Permissions = { flow: ["save"] };

export type MoveSecretToSpacePorts = ScopePorts & {
	access: Pick<Access, "openSpace">;
	projects: Reach<Pick<ProjectSecrets, "space">>;
};

/** The secret, the scope it moves from, and the Space. */
export type MoveSecretToSpace = {
	name: string;
	from: SecretScope;
	spaceId: string;
};

/**
 * Moves a saved secret of this computer, or a Personal one, into a Space:
 * it is saved in the Space first, then the copy it moved from goes. Only
 * the owner of this computer may, with a role that saves Flows.
 */
export const moveSecretToSpace =
	(ports: MoveSecretToSpacePorts) =>
	async (
		actor: PersonActor,
		{ name, from, spaceId }: MoveSecretToSpace,
	): Promise<void> => {
		ports.computerAccess.openComputer(actor);
		await ports.access.openSpace(actor, {
			spaceId,
			need: SAVES_FLOWS,
		});
		secretNameSchema.parse(name);
		const value = movedValue(await valueIn(ports, from, name), from, name);
		// Saved in the Space first: a failure there keeps this copy.
		await reachProjects(ports.projects).space.set(
			spaceId,
			name,
			value,
			actor.personId,
		);
		await removeIn(ports, from, name);
	};
