import { Refusal } from "@nightshift/refusal";
import type { Actor } from "../../../contract";
import {
	asProjects,
	cloneHere,
	NO_FOLDER,
	normaliseRemote,
	PROJECT_NOT_FOUND,
	type Project,
	type ProjectDirectory,
	type ProjectLog,
	type ProjectStore,
	type Repos,
	type SpaceProjects,
	type ThisDevice,
} from "../../keep";
import { folderTaken, noActiveRun, otherRepository } from "../domain/words";
import type { CloneImports, HostRelay, ProjectRuns } from "./ports";

export type UseProjectFolderPorts = {
	store: Pick<ProjectStore, "find" | "row" | "here" | "cloneRow">;
	spaceProjects: Pick<SpaceProjects, "recordCloneHere" | "clones">;
	projectLog: Pick<ProjectLog, "append">;
	thisDevice: ThisDevice;
	repos: Pick<Repos, "topLevel" | "origin">;
	directory: Pick<ProjectDirectory, "names">;
	relay?: HostRelay;
	runs: Pick<ProjectRuns, "runIds" | "isActive">;
	cloneImports: CloneImports;
};

/** The project, and the folder on this computer that becomes its folder here. */
export type UseProjectFolder = {
	spaceId: string;
	projectId: string;
	repoPath: string;
};

/**
 * Makes the git repository at `repoPath` the project's folder on this
 * computer: its first one, or in place of the one it has. The folder must
 * hold the project's repository (its `origin` names the project's remote,
 * in any case), and be no other project's folder. A run here works in the
 * folder it has: a new one waits for its end. The door checks the owner.
 */
export const useProjectFolder =
	(ports: UseProjectFolderPorts) =>
	async (_actor: Actor, request: UseProjectFolder): Promise<Project> => {
		const { spaceId, projectId } = request;
		const { store } = ports;
		const current = await store.find(projectId, spaceId);
		if (!current) throw new Refusal("not-found", PROJECT_NOT_FOUND);
		if (current.repoPath !== null) {
			await noActiveRun(ports.runs, projectId, "change its folder");
		}

		const row = await store.row(projectId);
		if (!row) throw new Refusal("not-found", PROJECT_NOT_FOUND);
		if (row.removedAt !== null || row.spaceId !== spaceId) {
			throw new Refusal("not-found", PROJECT_NOT_FOUND);
		}
		if (!row.folder) throw new Refusal("conflict", NO_FOLDER);
		const path = await ports.repos.topLevel(request.repoPath);
		const deviceId = await ports.thisDevice.deviceId();
		const [taken] = await store.here({ path });
		const used = { ...row, repoPath: path };
		if (taken?.id !== projectId) {
			if (taken) throw new Refusal("conflict", folderTaken(taken.name));
			const url = await ports.repos.origin(path);
			const remote = url === null ? null : normaliseRemote(url);
			if (remote?.toLowerCase() !== row.remote?.toLowerCase()) {
				throw new Refusal("invalid", otherRepository(row.remote));
			}
			const [here] = await store.here({ projectId });
			await cloneHere(
				{
					names: (ids) => ports.directory.names(ids),
					recordCloneHere: ports.spaceProjects.recordCloneHere,
					relay: ports.relay,
					cloneRow: store.cloneRow,
					append: (fact, before) => ports.projectLog.append(fact, before),
				},
				{ spaceId, projectId, deviceId, path },
				Boolean(here),
			);
		}

		await ports.cloneImports.importClone(used.id);
		const [project] = await asProjects(
			{
				clones: (id, ids) => ports.spaceProjects.clones(id, ids),
				deviceId: () => ports.thisDevice.deviceId(),
			},
			spaceId,
			[used],
		);
		if (!project) throw new Error("Could not use the folder.");
		return project;
	};
