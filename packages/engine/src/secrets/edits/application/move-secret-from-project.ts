import type { Permissions } from "@nightshift/auth";
import { secretNameSchema } from "@nightshift/flows";
import type { Access } from "../../../access";
import type { PersonActor, ProjectRef } from "../../../contract";
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

export type MoveSecretFromProjectPorts = ScopePorts & {
	access: Pick<Access, "openSpace">;
	projects: Reach<Pick<ProjectSecrets, "take" | "remove">>;
};

/** The Project, the secret, and the scope it moves to. */
export type MoveSecretFromProject = {
	project: ProjectRef;
	name: string;
	to: SecretScope;
};

/**
 * Moves a Project secret to this computer or to the Person's Personal
 * secrets. The Project's copy goes only after the new one is saved. Only
 * the owner of this computer may, with a role that saves Flows.
 */
export const moveSecretFromProject =
	(ports: MoveSecretFromProjectPorts) =>
	async (
		actor: PersonActor,
		{ project, name, to }: MoveSecretFromProject,
	): Promise<void> => {
		ports.computerAccess.openComputer(actor);
		await ports.access.openSpace(actor, {
			spaceId: project.spaceId,
			need: SAVES_FLOWS,
		});
		secretNameSchema.parse(name);
		const value = movedValue(
			await reachProjects(ports.projects).take(project, name, actor.personId),
			"project",
			name,
		);
		// Saved in its new scope first: a failure there keeps the Project's.
		await saveIn(ports, to, name, value);
		await reachProjects(ports.projects).remove(project, name, actor.personId);
		ports.known.projectNamesOf(project.projectId).delete(name);
	};
