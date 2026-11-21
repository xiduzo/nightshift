import { secretNameSchema } from "@nightshift/flows";
import type { Actor, ProjectRef } from "../../../contract";
import {
	movedValue,
	type ProjectSecrets,
	type Reach,
	reachProjects,
	type SecretScope,
	saveIn,
} from "../../scopes";
import type { ScopePorts } from "./save-secret";

export type MoveSecretFromProjectPorts = ScopePorts & {
	projects: Reach<Pick<ProjectSecrets, "take" | "remove">>;
};

/** The Project, the secret, the scope it moves to, and the Person who moves it. */
export type MoveSecretFromProject = {
	project: ProjectRef;
	name: string;
	to: SecretScope;
	personId: string;
};

/**
 * Moves a Project secret to this computer or to the Person's Personal
 * secrets. The Project's copy goes only after the new one is saved. The
 * keeper checks the Person's role, so the actor is not read.
 */
export const moveSecretFromProject =
	(ports: MoveSecretFromProjectPorts) =>
	async (
		_actor: Actor,
		{ project, name, to, personId }: MoveSecretFromProject,
	): Promise<void> => {
		secretNameSchema.parse(name);
		const value = movedValue(
			await reachProjects(ports.projects).take(project, name, personId),
			"project",
			name,
		);
		// Saved in its new scope first: a failure there keeps the Project's.
		await saveIn(ports, to, name, value);
		await reachProjects(ports.projects).remove(project, name, personId);
		ports.known.projectNamesOf(project.projectId).delete(name);
	};
