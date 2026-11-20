import { Refusal } from "@nightshift/refusal";
import type { Actor } from "../../../contract";
import {
	asProjects,
	defineProject,
	PROJECT_NOT_FOUND,
	type Project,
	type ProjectLog,
	type ProjectStore,
	type SpaceProjects,
	type ThisDevice,
} from "../../keep";

export type RenameProjectPorts = {
	store: Pick<ProjectStore, "find" | "row">;
	spaceProjects: Pick<SpaceProjects, "define" | "clones">;
	projectLog: Pick<ProjectLog, "append">;
	thisDevice: ThisDevice;
};

/** The project, and its new name. */
export type RenameProject = {
	spaceId: string;
	projectId: string;
	name: string;
};

/**
 * Gives the project a new name for every Member of the Space, in its Space
 * document and its row. It needs no Clone here. The door checks the
 * person's role.
 */
export const renameProject =
	(ports: RenameProjectPorts) =>
	async (_actor: Actor, request: RenameProject): Promise<Project> => {
		const { spaceId, projectId, name } = request;
		const { store } = ports;
		const notFound = () => new Refusal("not-found", PROJECT_NOT_FOUND);
		if (!(await store.find(projectId, spaceId))) throw notFound();
		const row = await store.row(projectId);
		if (!row) throw notFound();
		if (row.name !== name) {
			await defineProject(
				(r, change) => ports.spaceProjects.define(r, change),
				row,
				{ name },
			);
			await ports.projectLog.append({
				type: "ProjectRenamed",
				payload: { projectId, name },
			});
		}
		const renamed = await store.find(projectId, spaceId);
		if (!renamed) throw notFound();
		const [project] = await asProjects(
			{
				clones: (id, ids) => ports.spaceProjects.clones(id, ids),
				deviceId: () => ports.thisDevice.deviceId(),
			},
			spaceId,
			[renamed],
		);
		if (!project) throw notFound();
		return project;
	};
