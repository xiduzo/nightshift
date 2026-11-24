import { secretNameSchema } from "@nightshift/flows";
import type { PersonActor, ProjectRef } from "../../../contract";
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

/** The secret, the scope it moves from, and the Project. */
export type MoveSecretToProject = {
	name: string;
	from: SecretScope;
	project: ProjectRef;
};

/**
 * Moves a saved secret of this computer, or a Personal one, into the
 * Project (ADR 13, decision 7): it reads the value where it is, saves it as
 * the Project's, then removes the copy it moved from. Only the owner of
 * this computer may. The keeper checks their role: the move of another
 * Device ends here too.
 */
export const moveSecretToProject =
	(ports: MoveSecretToProjectPorts) =>
	async (
		actor: PersonActor,
		{ name, from, project }: MoveSecretToProject,
	): Promise<void> => {
		ports.computerAccess.openComputer(actor);
		secretNameSchema.parse(name);
		const value = movedValue(await valueIn(ports, from, name), from, name);
		// Saved in the Project first: a failure there keeps this copy.
		await reachProjects(ports.projects).set(
			project,
			name,
			value,
			actor.personId,
		);
		ports.known.projectNamesOf(project.projectId).add(name);
		await removeIn(ports, from, name);
	};
