import {
	type FlowSources,
	type Schedule,
	scheduleFlowInfos,
	validateSchedules,
} from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { ScheduleStore } from "../../application/ports";

/** The in-memory adapter of `ScheduleStore`, with what a test seeds. */
export type InMemoryScheduleStore = ScheduleStore & {
	/**
	 * Adds a project, or replaces what it has: its flows by name, and its
	 * schedules. A project that was never added cannot be read.
	 */
	seed(
		projectId: string,
		project?: { flows?: FlowSources; schedules?: readonly Schedule[] },
	): void;
};

export function inMemoryScheduleStore(): InMemoryScheduleStore {
	const projects = new Map<
		string,
		{ flows: FlowSources; schedules: Schedule[] }
	>();

	function projectOf(projectId: string) {
		const project = projects.get(projectId);
		if (!project) {
			throw new Refusal("not-found", "This project does not exist.");
		}
		return project;
	}

	return {
		seed(projectId, project = {}) {
			projects.set(projectId, {
				flows: project.flows ?? {},
				schedules: [...(project.schedules ?? [])],
			});
		},

		async list(projectId, options = {}) {
			const { flows, schedules } = projectOf(projectId);
			return {
				path: "schedules",
				schedules: [...schedules],
				issues:
					options.validate !== false
						? validateSchedules(schedules, scheduleFlowInfos(flows))
						: [],
			};
		},

		async save(projectId, schedules) {
			const project = projectOf(projectId);
			project.schedules = [...schedules];
			return validateSchedules(schedules, scheduleFlowInfos(project.flows));
		},

		async flows(projectId) {
			return projectOf(projectId).flows;
		},
	};
}
