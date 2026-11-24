import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../../access";
import type { PersonActor } from "../../../contract";
import { type ProjectSecrets, type Reach, reachProjects } from "../../scopes";

const SAVES_FLOWS: Permissions = { flow: ["save"] };

export type RemoveSpaceSecretPorts = {
	access: Pick<Access, "openSpace">;
	projects: Reach<Pick<ProjectSecrets, "space">>;
};

/** The Space and the secret. */
export type RemoveSpaceSecret = {
	spaceId: string;
	name: string;
};

/**
 * Removes a Space secret, as the Person who asks. Their role must save
 * Flows. The keeper checks it too.
 */
export const removeSpaceSecret =
	(ports: RemoveSpaceSecretPorts) =>
	async (
		actor: PersonActor,
		{ spaceId, name }: RemoveSpaceSecret,
	): Promise<void> => {
		await ports.access.openSpace(actor, {
			spaceId,
			need: SAVES_FLOWS,
		});
		await reachProjects(ports.projects).space.remove(
			spaceId,
			name,
			actor.personId,
		);
	};
