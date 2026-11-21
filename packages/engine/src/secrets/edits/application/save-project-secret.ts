import type { Actor, ProjectRef } from "../../../contract";
import {
	checkSecret,
	type KnownSecrets,
	type ProjectSecrets,
	type Reach,
	reachProjects,
} from "../../scopes";

export type SaveProjectSecretPorts = {
	projects: Reach<Pick<ProjectSecrets, "set">>;
	known: Pick<KnownSecrets, "projectNamesOf">;
};

/** The Project, the secret, and the Person who saves it. */
export type SaveProjectSecret = {
	project: ProjectRef;
	name: string;
	value: string;
	personId: string;
};

/**
 * Saves or replaces a Project secret, as `personId`: the keeper checks
 * that their role saves Flows, so the actor is not read.
 */
export const saveProjectSecret =
	(ports: SaveProjectSecretPorts) =>
	async (
		_actor: Actor,
		{ project, name, value, personId }: SaveProjectSecret,
	): Promise<void> => {
		checkSecret(name, value);
		await reachProjects(ports.projects).set(project, name, value, personId);
		ports.known.projectNamesOf(project.projectId).add(name);
	};
