import type { ProjectFlows } from "../../../flows";
import type { ScheduleStore } from "../../application/ports";

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
): ScheduleStore {
	return {
		list: (projectId, options) => flows.schedules(projectId, options),
		save: (projectId, schedules) => flows.saveSchedules(projectId, schedules),
		flows: (projectId) => flows.flows(projectId),
	};
}
