import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../../access";
import type { PersonActor } from "../../../contract";
import {
	checkSecret,
	type ProjectSecrets,
	type Reach,
	reachProjects,
} from "../../scopes";

const SAVES_FLOWS: Permissions = { flow: ["save"] };

export type SaveSpaceSecretPorts = {
	access: Pick<Access, "openSpace">;
	projects: Reach<Pick<ProjectSecrets, "space">>;
};

/** The Space and the secret. */
export type SaveSpaceSecret = {
	spaceId: string;
	name: string;
	value: string;
};

/**
 * Saves or replaces a Space secret, as the Person who asks. Their role must
 * save Flows. The keeper checks it too.
 */
export const saveSpaceSecret =
	(ports: SaveSpaceSecretPorts) =>
	async (
		actor: PersonActor,
		{ spaceId, name, value }: SaveSpaceSecret,
	): Promise<void> => {
		await ports.access.openSpace(actor, {
			spaceId,
			need: SAVES_FLOWS,
		});
		checkSecret(name, value);
		await reachProjects(ports.projects).space.set(
			spaceId,
			name,
			value,
			actor.personId,
		);
	};
