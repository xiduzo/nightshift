import type { Permissions } from "@nightshift/auth";
import { Refusal } from "@nightshift/refusal";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import {
	asProjects,
	cloneHere,
	createProject,
	HOSTED_ELSEWHERE,
	type NewIds,
	normaliseRemote,
	ownSpace,
	PROJECT_NOT_FOUND,
	type Project,
	type ProjectDirectory,
	type ProjectLog,
	type ProjectRecord,
	type ProjectStore,
	type Repos,
	recordCloneHere,
	restoreProject,
	type SpaceProjects,
	type ThisDevice,
} from "../../keep";
import { alreadyHere, folderName, HOSTED_NEEDS_REMOTE } from "../domain/words";
import type { CloneImports, HostRelay } from "./ports";

/** What a role must allow for this request. */
const ADD_PROJECTS: Permissions = { project: ["add"] };

export type AddProjectPorts = {
	access: Pick<Access, "openSpace">;
	store: Pick<
		ProjectStore,
		"here" | "byRemote" | "row" | "keepHosted" | "addClone" | "cloneRow"
	>;
	spaceProjects: Pick<
		SpaceProjects,
		"define" | "create" | "recordCloneHere" | "clones"
	>;
	projectLog: ProjectLog;
	thisDevice: ThisDevice;
	repos: Pick<Repos, "topLevel" | "origin" | "exists">;
	directory: ProjectDirectory;
	relay?: HostRelay;
	ids: NewIds;
	cloneImports: CloneImports;
};

/** The folder to add, in which Space, and the name a new project gets. */
export type AddProject = { spaceId: string; repoPath: string; name?: string };

/**
 * Adds the git repository at `repoPath` as a project of the Space: the one
 * with a Clone there, else the one with its remote, else a new one. A
 * removed project comes back. A project of another Space is refused. A
 * folder from before ADR 2 brings its flows in. Refuses a Person who may not act (`access.openSpace`).
 */
export const addProject =
	(ports: AddProjectPorts) =>
	async (actor: Actor, request: AddProject): Promise<Project> => {
		await ports.access.openSpace(actor, {
			spaceId: request.spaceId,
			need: ADD_PROJECTS,
		});
		const row = await addFolder(ports, request);
		await ports.cloneImports.importClone(row.id);
		const [added] = await asProjects(
			{
				clones: (spaceId, ids) => ports.spaceProjects.clones(spaceId, ids),
				deviceId: () => ports.thisDevice.deviceId(),
			},
			request.spaceId,
			[row],
		);
		if (!added) throw new Error("Could not add the project.");
		return added;
	};

/** The project of the folder, with the folder as its Clone here. */
async function addFolder(ports: AddProjectPorts, request: AddProject) {
	const { spaceId } = request;
	const { store, spaceProjects, projectLog } = ports;
	const restore = <T extends ProjectRecord>(row: T) =>
		restoreProject(row, {
			define: (r, change) => spaceProjects.define(r, change),
			append: (fact) => projectLog.append(fact),
		});
	const recordSteps = {
		names: (ids: readonly string[]) => ports.directory.names(ids),
		recordCloneHere: spaceProjects.recordCloneHere,
		relay: ports.relay,
	};

	const path = await ports.repos.topLevel(request.repoPath);
	const deviceId = await ports.thisDevice.deviceId();
	const [here] = await store.here({ path });
	if (here) return restore(ownSpace(here, spaceId));

	const url = await ports.repos.origin(path);
	const remote = url === null ? null : normaliseRemote(url);
	const found = remote ? await store.byRemote(remote) : null;
	if (found) ownSpace(found, spaceId);
	// A Space a Host keeps: the Host adds a new Project, or restores a
	// removed one, and this folder becomes its Clone.
	const onHost =
		remote !== null &&
		(!found || found.removedAt !== null) &&
		(await ports.directory.hostedElsewhere(spaceId));
	const known = onHost
		? await addOnHost(ports, spaceId, {
				name: folderName(path, request.name),
				remote,
			})
		: found;
	if (known) {
		ownSpace(known, spaceId);
		const [elsewhere] = await store.here({ projectId: known.id });
		// A removed project's Clone may move: its Host restored it just now.
		if (
			elsewhere &&
			(found?.removedAt ?? null) === null &&
			ports.repos.exists(elsewhere.repoPath)
		) {
			throw new Refusal("conflict", alreadyHere(elsewhere.repoPath));
		}
		await cloneHere(
			{
				...recordSteps,
				cloneRow: store.cloneRow,
				append: (fact, before) => projectLog.append(fact, before),
			},
			{ spaceId, projectId: known.id, deviceId, path },
			Boolean(elsewhere),
		);
		return restore({ ...known, repoPath: path });
	}

	// The Space document defines the Project; its row follows.
	const id = ports.ids.projectId();
	const name = folderName(path, request.name);
	const row = await createProject(
		{ create: spaceProjects.create, row: store.row },
		{
			spaceId,
			projectId: id,
			entry: { name, remote, folder: true },
			onHost: HOSTED_NEEDS_REMOTE,
		},
	);
	await store.addClone({ spaceId, projectId: id, deviceId, path });
	await recordCloneHere(recordSteps, { spaceId, projectId: id, deviceId });
	await projectLog.append({
		type: "ProjectAdded",
		payload: { projectId: id, name, repoPath: path, remote },
	});
	return { ...row, repoPath: path };
}

/**
 * Asks the Host that keeps the Space to add the Project, and keeps its
 * row here at once: the Space document brings the same entry a moment
 * later, and its projection finds the row in step.
 */
async function addOnHost(
	ports: AddProjectPorts,
	spaceId: string,
	input: { name: string; remote: string },
): Promise<ProjectRecord> {
	if (!ports.relay) throw new Refusal("conflict", HOSTED_ELSEWHERE);
	const { projectId } = await ports.relay.addProject({ spaceId, ...input });
	await ports.store.keepHosted({ id: projectId, spaceId, ...input });
	const row = await ports.store.row(projectId);
	if (!row) throw new Refusal("not-found", PROJECT_NOT_FOUND);
	return row;
}
