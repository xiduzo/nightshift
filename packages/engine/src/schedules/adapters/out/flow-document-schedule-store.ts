import type { ProjectFlows } from "../../../flows";
import type { PausedHere, ScheduleStore } from "../../application/ports";
import { readHere, savedHere } from "../../domain/paused-here";

/**
 * The schedules of each project in its flow document (ADR 2), through
 * the flows slice (`ProjectFlows`): the document syncs, so a schedule
 * saved on one Device reaches the Host that fires it.
 */
export type FlowDocumentScheduleStoreDeps = Pick<
	ProjectFlows,
	"schedules" | "saveSchedules" | "flows"
>;

export function flowDocumentScheduleStore(
	flows: FlowDocumentScheduleStoreDeps,
	pausedHere: PausedHere = { of: async () => new Set(), ended: async () => {} },
): ScheduleStore {
	return {
		async list(projectId, options) {
			const list = await flows.schedules(projectId, options);
			const paused = await pausedHere.of(projectId);
			if (paused.size === 0) return list;
			return {
				...list,
				schedules: list.schedules.map((s) => readHere(s, paused)),
			};
		},
		async save(projectId, schedules) {
			const paused = await pausedHere.of(projectId);
			if (paused.size === 0) return flows.saveSchedules(projectId, schedules);
			const stored = await flows.schedules(projectId, { validate: false });
			const saved = savedHere(schedules, stored.schedules, paused);
			const issues = await flows.saveSchedules(projectId, saved.schedules);
			// Last: a stop before it leaves them paused.
			if (saved.ended.length > 0) {
				await pausedHere.ended(projectId, saved.ended);
			}
			return issues;
		},
		flows: (projectId) => flows.flows(projectId),
	};
}
