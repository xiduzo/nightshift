import type { Permissions } from "@nightshift/auth";
import { Refusal } from "@nightshift/refusal";
import type { Actor } from "../../../contract";
import {
	asProjects,
	createProject,
	HOSTED_ELSEWHERE,
	type NewIds,
	PROJECT_NOT_FOUND,
	type Project,
	type ProjectDirectory,
	type ProjectLog,
	type ProjectStore,
	type SpaceProjects,
	type ThisDevice,
} from "../../keep";
import type { HostRelay, ProjectAccess } from "./ports";

/** What a role must allow for this request. */
const ADD_PROJECTS: Permissions = { project: ["add"] };

export type AddProjectWithoutFolderPorts = {
	access: ProjectAccess;
	store: Pick<ProjectStore, "row" | "keepHostedWithoutFolder">;
	spaceProjects: Pick<SpaceProjects, "create" | "clones">;
	projectLog: Pick<ProjectLog, "append">;
	thisDevice: ThisDevice;
	directory: Pick<ProjectDirectory, "hostedElsewhere">;
	relay?: HostRelay;
	ids: NewIds;
};

/** The Space, and the name of the new project. */
export type AddProjectWithoutFolder = { spaceId: string; name: string };

/**
 * A new project without a folder in the Space (ADR 22): no remote and no
 * Clone, on any Device. In a Space a Host keeps, the Host adds it, and its
 * row is kept here at once: the Space document brings the same entry a
 * moment later. Each call adds another project: a name may repeat. The
 * door checks the person's role (`access.openSpace`).
 */
export const addProjectWithoutFolder =
	(ports: AddProjectWithoutFolderPorts) =>
	async (actor: Actor, request: AddProjectWithoutFolder): Promise<Project> => {
		await ports.access.openSpace(actor, {
			spaceId: request.spaceId,
			need: ADD_PROJECTS,
		});
		const { spaceId, name } = request;
		const { store } = ports;
		let projectId: string;
		if (await ports.directory.hostedElsewhere(spaceId)) {
			if (!ports.relay) throw new Refusal("conflict", HOSTED_ELSEWHERE);
			({ projectId } = await ports.relay.addWithoutFolder({ spaceId, name }));
			await store.keepHostedWithoutFolder({ id: projectId, spaceId, name });
		} else {
			projectId = ports.ids.projectId();
			await createProject(
				{ create: ports.spaceProjects.create, row: store.row },
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
		}
		const row = await store.row(projectId);
		if (!row) throw new Refusal("not-found", PROJECT_NOT_FOUND);
		const [added] = await asProjects(
			{
				clones: (id, ids) => ports.spaceProjects.clones(id, ids),
				deviceId: () => ports.thisDevice.deviceId(),
			},
			spaceId,
			[{ ...row, repoPath: null }],
		);
		if (!added) throw new Error("Could not add the project.");
		return added;
	};
