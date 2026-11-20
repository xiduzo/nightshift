import type { Actor } from "../../../contract";
import type { KeptValue } from "../../../variables";
import type { KeptValues, SpaceProjects } from "./ports";

export type ListKeptValuesPorts = {
	projects: SpaceProjects;
	kept: Pick<KeptValues, "list">;
};

/**
 * The values the kept variables of a flow of a project of the Space carry
 * from one run to the next on this computer.
 */
export const listKeptValues =
	(ports: ListKeptValuesPorts) =>
	async (
		_actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			flowName: string;
		},
	): Promise<KeptValue[]> => {
		const { spaceId, projectId, flowName } = request;
		await ports.projects.inSpace(projectId, spaceId);
		return ports.kept.list({ spaceId, projectId, flowName });
	};
