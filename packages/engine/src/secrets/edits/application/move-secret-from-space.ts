import type { Permissions } from "@nightshift/auth";
import { secretNameSchema } from "@nightshift/flows";
import type { Access } from "../../../access";
import type { PersonActor } from "../../../contract";
import {
	movedValue,
	type ProjectSecrets,
	type Reach,
	reachProjects,
	type SecretScope,
	saveIn,
} from "../../scopes";
import type { ScopePorts } from "./save-secret";

const SAVES_FLOWS: Permissions = { flow: ["save"] };

export type MoveSecretFromSpacePorts = ScopePorts & {
	access: Pick<Access, "openSpace">;
	projects: Reach<Pick<ProjectSecrets, "space">>;
};

/** The Space, the secret, and the scope it moves to. */
export type MoveSecretFromSpace = {
	spaceId: string;
	name: string;
	to: SecretScope;
};

/**
 * Moves a Space's secret to this computer, or to its owner's Personal
 * secrets. The Space's copy goes only after the new one is saved. Only the
 * owner of this computer may, with a role that saves Flows.
 */
export const moveSecretFromSpace =
	(ports: MoveSecretFromSpacePorts) =>
	async (
		actor: PersonActor,
		{ spaceId, name, to }: MoveSecretFromSpace,
	): Promise<void> => {
		ports.computerAccess.openComputer(actor);
		await ports.access.openSpace(actor, {
			spaceId,
			need: SAVES_FLOWS,
		});
		secretNameSchema.parse(name);
		const value = movedValue(
			await reachProjects(ports.projects).space.take(
				spaceId,
				name,
				actor.personId,
			),
			"space",
			name,
		);
		// Saved in its new scope first: a failure there keeps the Space's.
		await saveIn(ports, to, name, value);
		await reachProjects(ports.projects).space.remove(
			spaceId,
			name,
			actor.personId,
		);
	};
