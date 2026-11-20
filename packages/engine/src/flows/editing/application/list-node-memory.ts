import type { Actor } from "../../../contract";
import type { NodeMemory as Remembered } from "../../../memory";
import type { NodeMemory, SpaceProjects } from "./ports";

export type ListNodeMemoryPorts = {
	projects: SpaceProjects;
	memory: Pick<NodeMemory, "list">;
};

/**
 * What the Since last run nodes of a flow of a project of the Space
 * remember between runs on this computer, per node and scope.
 */
export const listNodeMemory =
	(ports: ListNodeMemoryPorts) =>
	async (
		_actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			flowName: string;
		},
	): Promise<Remembered[]> => {
		const { spaceId, projectId, flowName } = request;
		await ports.projects.inSpace(projectId, spaceId);
		return ports.memory.list({ spaceId, projectId, flowName });
	};
