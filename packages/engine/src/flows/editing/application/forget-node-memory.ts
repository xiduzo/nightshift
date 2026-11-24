import type { Permissions } from "@nightshift/auth";
import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { NodeMemory, SpaceProjects } from "./ports";

const SAVES_FLOWS: Permissions = { flow: ["save"] };

export type ForgetNodeMemoryPorts = {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	memory: Pick<NodeMemory, "forget">;
};

/**
 * Forgets what a Since last run node of a flow saw, in every scope or in
 * one: its next run is a first run. Refuses a Person whose role does not
 * save flows (`access.openSpace`). The door lets only the owner of this
 * computer ask.
 */
export const forgetNodeMemory =
	(ports: ForgetNodeMemoryPorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			flowName: string;
			node: string;
			scope?: string;
		},
	): Promise<void> => {
		await ports.access.openSpace(actor, {
			spaceId: request.spaceId,
			need: SAVES_FLOWS,
		});
		const { spaceId, projectId, flowName } = request;
		await ports.projects.inSpace(projectId, spaceId);
		await ports.memory.forget(
			{ spaceId, projectId, flowName },
			request.node,
			request.scope,
		);
	};
