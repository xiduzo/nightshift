import type { Access } from "../../../access";
import type { Actor } from "../../../contract";
import type { FlowNotice, ProjectFlows } from "../../store";
import type { SpaceProjects } from "./ports";

export type ListFlowNoticesPorts = {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "notices">;
};

/**
 * What a person must know about the flows of a project of the Space,
 * oldest first.
 * A Member of the Space may, whatever the role (`access.openSpace`).
 */
export const listFlowNotices =
	(ports: ListFlowNoticesPorts) =>
	async (
		actor: Actor,
		request: { spaceId: string; projectId: string },
	): Promise<FlowNotice[]> => {
		await ports.access.openSpace(actor, { spaceId: request.spaceId });
		await ports.projects.inSpace(request.projectId, request.spaceId);
		return ports.flows.notices(request.projectId);
	};
