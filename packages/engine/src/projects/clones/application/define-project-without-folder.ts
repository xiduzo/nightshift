import {
	createProject,
	HOSTED_ELSEWHERE,
	type NewIds,
	type ProjectLog,
	type ProjectStore,
	type SpaceProjects,
} from "../../keep";

export type DefineProjectWithoutFolderPorts = {
	store: Pick<ProjectStore, "row">;
	spaceProjects: Pick<SpaceProjects, "create">;
	projectLog: Pick<ProjectLog, "append">;
	ids: NewIds;
};

/** The Space, and the name of the new project. */
export type DefineProjectWithoutFolder = { spaceId: string; name: string };

/**
 * Defines a new project without a folder in the Space's document, which
 * this Replica keeps: on a Host, for a Device that asks it. Each call adds
 * another project: a name may repeat.
 */
export const defineProjectWithoutFolder =
	(ports: DefineProjectWithoutFolderPorts) =>
	async (
		request: DefineProjectWithoutFolder,
	): Promise<{ projectId: string }> => {
		const { spaceId, name } = request;
		const projectId = ports.ids.projectId();
		await createProject(
			{ create: ports.spaceProjects.create, row: ports.store.row },
			{
				spaceId,
				projectId,
				entry: { name, remote: null, folder: false },
				onHost: HOSTED_ELSEWHERE,
			},
		);
		await ports.projectLog.append({
			type: "ProjectAdded",
			payload: { projectId, name, remote: null, folder: false },
		});
		return { projectId };
	};
