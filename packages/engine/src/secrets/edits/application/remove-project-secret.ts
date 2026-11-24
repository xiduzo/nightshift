import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../../access";
import type { PersonActor, ProjectRef } from "../../../contract";
import {
	type KnownSecrets,
	type ProjectSecrets,
	type Reach,
	reachProjects,
} from "../../scopes";

const SAVES_FLOWS: Permissions = { flow: ["save"] };

export type RemoveProjectSecretPorts = {
	access: Pick<Access, "openSpace">;
	projects: Reach<Pick<ProjectSecrets, "remove">>;
	known: Pick<KnownSecrets, "projectNamesOf">;
};

/** The Project and the secret. */
export type RemoveProjectSecret = {
	project: ProjectRef;
	name: string;
};

/**
 * Removes a Project secret, as the Person who asks. Their role must save
 * Flows. The keeper checks it too.
 */
export const removeProjectSecret =
	(ports: RemoveProjectSecretPorts) =>
	async (
		actor: PersonActor,
		{ project, name }: RemoveProjectSecret,
	): Promise<void> => {
		await ports.access.openSpace(actor, {
			spaceId: project.spaceId,
			need: SAVES_FLOWS,
		});
		await reachProjects(ports.projects).remove(project, name, actor.personId);
		ports.known.projectNamesOf(project.projectId).delete(name);
	};
