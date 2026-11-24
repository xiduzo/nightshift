import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import {
	asProjects,
	type Project,
	type ProjectStore,
	type SpaceProjects,
	type ThisDevice,
} from "../../keep";

export type ListProjectsPorts = {
	access: Pick<Access, "openSpace">;
	store: Pick<ProjectStore, "listInSpace">;
	spaceProjects: Pick<SpaceProjects, "clones">;
	thisDevice: ThisDevice;
};

/** Which Space the request is for. */
export type ListProjects = { spaceId: string };

/**
 * Lists the projects of the Space a person has not removed, oldest first,
 * with the Devices that have a Clone of each. A Member of the Space may,
 * whatever the role (`access.openSpace`).
 */
export const listProjects =
	(ports: ListProjectsPorts) =>
	async (actor: Actor, request: ListProjects): Promise<Project[]> => {
		await ports.access.openSpace(actor, { spaceId: request.spaceId });
		return asProjects(
			{
				clones: (spaceId, ids) => ports.spaceProjects.clones(spaceId, ids),
				deviceId: () => ports.thisDevice.deviceId(),
			},
			request.spaceId,
			await ports.store.listInSpace(request.spaceId),
		);
	};
