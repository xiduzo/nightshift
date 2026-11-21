import type { Actor, ProjectRef } from "../../../contract";
import {
	type KnownSecrets,
	type ProjectSecretName,
	type ProjectSecrets,
	type Reach,
	reachProjects,
} from "../../scopes";

export type ListProjectSecretsPorts = {
	projects: Reach<Pick<ProjectSecrets, "list">>;
	known: Pick<KnownSecrets, "projectNamesOf">;
};

/** The Project, and the Person the keeper lists the names to. */
export type ListProjectSecrets = { project: ProjectRef; personId: string };

/**
 * The secrets of a Project, as `personId` may see them: names, when each
 * was set and by whom. This computer remembers the names, to fail closed
 * while they cannot be read. Throws when they cannot be read now. The
 * keeper checks the Person: the actor is not read.
 */
export const listProjectSecrets =
	(ports: ListProjectSecretsPorts) =>
	async (
		_actor: Actor,
		{ project, personId }: ListProjectSecrets,
	): Promise<ProjectSecretName[]> => {
		const listed = await reachProjects(ports.projects).list(project, personId);
		const known = ports.known.projectNamesOf(project.projectId);
		known.clear();
		for (const { name } of listed) known.add(name);
		return listed;
	};
