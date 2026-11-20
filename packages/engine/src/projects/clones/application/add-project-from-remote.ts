import {
	createProject,
	HOSTED_ELSEWHERE,
	type NewIds,
	ownSpace,
	type ProjectLog,
	type ProjectStore,
	restoreProject,
	type SpaceProjects,
} from "../../keep";

export type AddProjectFromRemotePorts = {
	store: Pick<ProjectStore, "byRemote" | "row">;
	spaceProjects: Pick<SpaceProjects, "define" | "create">;
	projectLog: Pick<ProjectLog, "append">;
	ids: NewIds;
};

/** The Space, and the project a Device asks for: its remote, normalised by the Device. */
export type AddProjectFromRemote = {
	spaceId: string;
	name: string;
	remote: string;
};

/**
 * The project of a remote in the Space, for a Device that asks its Host:
 * the one with this remote, restored when a person removed it, else a new
 * one without a Clone here. The Host copies it from GitHub on its own.
 */
export const addProjectFromRemote =
	(ports: AddProjectFromRemotePorts) =>
	async (request: AddProjectFromRemote): Promise<{ projectId: string }> => {
		const { spaceId, name, remote } = request;
		const found = await ports.store.byRemote(remote);
		if (found) {
			await restoreProject(ownSpace(found, spaceId), {
				define: (row, change) => ports.spaceProjects.define(row, change),
				append: (fact) => ports.projectLog.append(fact),
			});
			return { projectId: found.id };
		}
		const projectId = ports.ids.projectId();
		await createProject(
			{ create: ports.spaceProjects.create, row: ports.store.row },
			{
				spaceId,
				projectId,
				entry: { name, remote, folder: true },
				onHost: HOSTED_ELSEWHERE,
			},
		);
		await ports.projectLog.append({
			type: "ProjectAdded",
			payload: { projectId, name, remote },
		});
		return { projectId };
	};
