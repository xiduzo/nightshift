import {
	type Schedule,
	type ScheduleIssue,
	scheduleFlowInfos,
	validateSchedules,
} from "@nightshift/flows";
import type { FlowStore, ProjectSpaces } from "./ports";

export type SaveProjectSchedulesPorts = {
	store: Pick<FlowStore, "saveSchedules" | "read">;
	projects: ProjectSpaces;
};

/**
 * Saves the project's schedules, those with problems too. Returns their
 * issues against the project's flows as a read gives them.
 */
export const saveProjectSchedules =
	(ports: SaveProjectSchedulesPorts) =>
	async (request: {
		projectId: string;
		schedules: readonly Schedule[];
	}): Promise<ScheduleIssue[]> => {
		const { projectId, schedules } = request;
		await ports.projects.spaceOf(projectId);
		await ports.store.saveSchedules(projectId, schedules);
		const sources = await ports.store.read(projectId);
		return validateSchedules(schedules, scheduleFlowInfos(sources));
	};
