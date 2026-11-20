import type { FlowStore, ProjectSpaces } from "./ports";

export type DismissProjectFlowNoticePorts = {
	store: Pick<FlowStore, "dismissNotice">;
	projects: ProjectSpaces;
};

/** Removes a notice, on every Device of the Space. One that is gone already is no error. */
export const dismissProjectFlowNotice =
	(ports: DismissProjectFlowNoticePorts) =>
	async (request: { projectId: string; noticeId: string }): Promise<void> => {
		await ports.projects.spaceOf(request.projectId);
		await ports.store.dismissNotice(request.projectId, request.noticeId);
	};
