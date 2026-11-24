import {
	type Schedule,
	type ScheduleIssue,
	scheduleFlowInfos,
	validateSchedules,
} from "@nightshift/flows";
import { unreadableSchedules } from "../domain/flow-save";
import type { FlowStore, ProjectSpaces } from "./ports";

export type ReadProjectSchedulesPorts = {
	store: Pick<FlowStore, "schedules" | "read">;
	projects: ProjectSpaces;
};

/** The schedules of a project as read. */
export type ProjectSchedules = {
	/** Where the schedules are. */
	path: string;
	/** Empty when they do not load. */
	schedules: Schedule[];
	/** Problems of the whole (no `scheduleId`) and of each schedule. */
	issues: ScheduleIssue[];
};

/**
 * The project's schedules. `validate` (default true) checks each against
 * the project's flows as a read gives them.
 */
export const readProjectSchedules =
	(ports: ReadProjectSchedulesPorts) =>
	async (request: {
		projectId: string;
		validate?: boolean;
	}): Promise<ProjectSchedules> => {
		const { projectId } = request;
		await ports.projects.spaceOf(projectId);
		const { schedules, unreadable } = await ports.store.schedules(projectId);
		const issues = unreadableSchedules(unreadable);
		if (request.validate !== false) {
			const sources = await ports.store.read(projectId);
			issues.push(...validateSchedules(schedules, scheduleFlowInfos(sources)));
		}
		return { path: "schedules", schedules, issues };
	};
