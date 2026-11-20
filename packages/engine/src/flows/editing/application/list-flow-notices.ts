import type { Actor } from "../../../contract";
import type { FlowNotice } from "../../store";
import type { SavedFlows, SpaceProjects } from "./ports";

export type ListFlowNoticesPorts = {
	projects: SpaceProjects;
	flows: Pick<SavedFlows, "notices">;
};

/**
 * What a person must know about the flows of a project of the Space (the
 * import on upgrade), oldest first.
 */
export const listFlowNotices =
	(ports: ListFlowNoticesPorts) =>
	async (
		_actor: Actor,
		request: { spaceId: string; projectId: string },
	): Promise<FlowNotice[]> => {
		await ports.projects.inSpace(request.projectId, request.spaceId);
		return ports.flows.notices(request.projectId);
	};
