import { Refusal } from "@nightshift/refusal";
import {
	type CloneRecord,
	NO_FOLDER,
	PROJECT_NOT_FOUND,
	type SpaceProjects,
} from "../../keep";

export type RecordClonePorts = {
	spaceProjects: Pick<SpaceProjects, "recordClone">;
};

/** The Space, and the Clone of another Device. */
export type RecordClone = { spaceId: string; clone: CloneRecord };

/**
 * Records another Device's Clone of a project in the Space's document, on
 * the Host that keeps the Space. Not found when this Replica does not keep
 * the Space, or its document has no entry of the project. A Device
 * may give a folder to a project without one: refused.
 */
export const recordClone =
	(ports: RecordClonePorts) =>
	async (request: RecordClone): Promise<void> => {
		const outcome = await ports.spaceProjects.recordClone(
			request.spaceId,
			request.clone,
		);
		if (outcome === "unknown") {
			throw new Refusal("not-found", PROJECT_NOT_FOUND);
		}
		if (outcome === "without-folder") throw new Refusal("conflict", NO_FOLDER);
	};
