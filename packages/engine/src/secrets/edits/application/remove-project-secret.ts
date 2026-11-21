import type { Actor, ProjectRef } from "../../../contract";
import {
	type KnownSecrets,
	type ProjectSecrets,
	type Reach,
	reachProjects,
} from "../../scopes";

export type RemoveProjectSecretPorts = {
	projects: Reach<Pick<ProjectSecrets, "remove">>;
	known: Pick<KnownSecrets, "projectNamesOf">;
};

/** The Project, the secret, and the Person who removes it. */
export type RemoveProjectSecret = {
	project: ProjectRef;
	name: string;
	personId: string;
};

/** Removes a Project secret, as `personId`: the keeper checks their role, so the actor is not read. */
export const removeProjectSecret =
	(ports: RemoveProjectSecretPorts) =>
	async (
		_actor: Actor,
		{ project, name, personId }: RemoveProjectSecret,
	): Promise<void> => {
		await reachProjects(ports.projects).remove(project, name, personId);
		ports.known.projectNamesOf(project.projectId).delete(name);
	};
