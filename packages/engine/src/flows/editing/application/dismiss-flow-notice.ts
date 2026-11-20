import type { Actor } from "../../../contract";
import type { SavedFlows, SpaceProjects } from "./ports";

export type DismissFlowNoticePorts = {
	projects: SpaceProjects;
	flows: Pick<SavedFlows, "dismissNotice">;
};

/**
 * Removes a notice of the flows of a project of the Space, on every Device
 * of the Space.
 */
export const dismissFlowNotice =
	(ports: DismissFlowNoticePorts) =>
	async (
		_actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			noticeId: string;
		},
	): Promise<void> => {
		await ports.projects.inSpace(request.projectId, request.spaceId);
		await ports.flows.dismissNotice(request.projectId, request.noticeId);
	};
