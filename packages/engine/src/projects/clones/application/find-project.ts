import { Refusal } from "@nightshift/refusal";
import {
	type ListedProject,
	PROJECT_NOT_FOUND,
	type ProjectStore,
} from "../../keep";

export type FindProjectPorts = {
	store: Pick<ProjectStore, "find">;
};

/** The project, and the Space it must be in. Without one, any Space. */
export type FindProject = { projectId: string; spaceId?: string };

/**
 * A project a person has not removed, with its folder here or null: what
 * a Space-level change and a run placed on another Device need. With a
 * Space, a project of another Space is not found.
 */
export const findProject =
	(ports: FindProjectPorts) =>
	async (request: FindProject): Promise<ListedProject> => {
		const found = await ports.store.find(request.projectId, request.spaceId);
		if (!found) throw new Refusal("not-found", PROJECT_NOT_FOUND);
		return found;
	};
