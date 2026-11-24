import type { Access } from "../../../access";
import type { PersonActor, ProjectRef } from "../../../contract";
import {
	type KnownSecrets,
	type ProjectSecretName,
	type ProjectSecrets,
	type Reach,
	reachProjects,
} from "../../scopes";

export type ListProjectSecretsPorts = {
	access: Pick<Access, "openSpace">;
	projects: Reach<Pick<ProjectSecrets, "list">>;
	known: Pick<KnownSecrets, "projectNamesOf">;
};

/** The Project. */
export type ListProjectSecrets = { project: ProjectRef };

/**
 * The secrets of a Project, as the Person who asks may see them: names,
 * when each was set and by whom. This computer remembers the names, to fail
 * closed while they cannot be read. Throws when they cannot be read now. A
 * Member of the Space may, whatever the role.
 */
export const listProjectSecrets =
	(ports: ListProjectSecretsPorts) =>
	async (
		actor: PersonActor,
		{ project }: ListProjectSecrets,
	): Promise<ProjectSecretName[]> => {
		await ports.access.openSpace(actor, { spaceId: project.spaceId });
		const listed = await reachProjects(ports.projects).list(
			project,
			actor.personId,
		);
		const known = ports.known.projectNamesOf(project.projectId);
		known.clear();
		for (const { name } of listed) known.add(name);
		return listed;
	};
