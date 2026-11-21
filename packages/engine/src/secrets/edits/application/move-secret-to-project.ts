import { secretNameSchema } from "@nightshift/flows";
import type { Actor, ProjectRef } from "../../../contract";
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

export type MoveSecretToProjectPorts = ScopePorts & {
	projects: Reach<Pick<ProjectSecrets, "set">>;
};

/** The secret, the scope it moves from, the Project, and the Person who moves it. */
export type MoveSecretToProject = {
	name: string;
	from: SecretScope;
	project: ProjectRef;
	personId: string;
};

/**
 * Moves a saved secret of this computer, or a Personal one, into the
 * Project (ADR 13, decision 7): it reads the value where it is, saves it
 * as the Project's, then removes the copy it moved from. The keeper
 * checks the Person's role, so the actor is not read.
 */
export const moveSecretToProject =
	(ports: MoveSecretToProjectPorts) =>
	async (
		_actor: Actor,
		{ name, from, project, personId }: MoveSecretToProject,
	): Promise<void> => {
		secretNameSchema.parse(name);
		const value = movedValue(await valueIn(ports, from, name), from, name);
		// Saved in the Project first: a failure there keeps this copy.
		await reachProjects(ports.projects).set(project, name, value, personId);
		ports.known.projectNamesOf(project.projectId).add(name);
		await removeIn(ports, from, name);
	};
