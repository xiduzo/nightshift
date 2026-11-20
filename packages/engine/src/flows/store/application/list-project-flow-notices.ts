import type { FlowNotice } from "../domain/notices";
import type { FlowStore, ProjectSpaces } from "./ports";

export type ListProjectFlowNoticesPorts = {
	store: Pick<FlowStore, "notices">;
	projects: ProjectSpaces;
};

/** What a person must know about the project's flows (the import on upgrade), oldest first. */
export const listProjectFlowNotices =
	(ports: ListProjectFlowNoticesPorts) =>
	async (request: { projectId: string }): Promise<FlowNotice[]> => {
		await ports.projects.spaceOf(request.projectId);
		return ports.store.notices(request.projectId);
	};
