import type { Actor } from "../../../contract";
import type { NodeMemory, SpaceProjects } from "./ports";

export type ForgetNodeMemoryPorts = {
	projects: SpaceProjects;
	memory: Pick<NodeMemory, "forget">;
};

/**
 * Forgets what a Since last run node of a flow saw, in every scope or in
 * one: its next run is a first run.
 */
export const forgetNodeMemory =
	(ports: ForgetNodeMemoryPorts) =>
	async (
		_actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			flowName: string;
			node: string;
			scope?: string;
		},
	): Promise<void> => {
		const { spaceId, projectId, flowName } = request;
		await ports.projects.inSpace(projectId, spaceId);
		await ports.memory.forget(
			{ spaceId, projectId, flowName },
			request.node,
			request.scope,
		);
	};
