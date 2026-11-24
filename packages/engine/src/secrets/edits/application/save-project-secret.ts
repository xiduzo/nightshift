import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../../access";
import type { PersonActor, ProjectRef } from "../../../contract";
import {
	checkSecret,
	type KnownSecrets,
	type ProjectSecrets,
	type Reach,
	reachProjects,
} from "../../scopes";

const SAVES_FLOWS: Permissions = { flow: ["save"] };

export type SaveProjectSecretPorts = {
	access: Pick<Access, "openSpace">;
	projects: Reach<Pick<ProjectSecrets, "set">>;
	known: Pick<KnownSecrets, "projectNamesOf">;
};

/** The Project and the secret. */
export type SaveProjectSecret = {
	project: ProjectRef;
	name: string;
	value: string;
};

/**
 * Saves or replaces a Project secret, as the Person who asks. Their role
 * must save Flows. The keeper checks it too.
 */
export const saveProjectSecret =
	(ports: SaveProjectSecretPorts) =>
	async (
		actor: PersonActor,
		{ project, name, value }: SaveProjectSecret,
	): Promise<void> => {
		await ports.access.openSpace(actor, {
			spaceId: project.spaceId,
			need: SAVES_FLOWS,
		});
		checkSecret(name, value);
		await reachProjects(ports.projects).set(
			project,
			name,
			value,
			actor.personId,
		);
		ports.known.projectNamesOf(project.projectId).add(name);
	};
