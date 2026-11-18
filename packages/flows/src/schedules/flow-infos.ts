import { type FlowSources, parsedFlows, parseFlow } from "../validate";
import type { ScheduleFlowInfo } from "./schedules";

/** The inputs and the error count of every flow of the sources, for `validateSchedules`. */
export function scheduleFlowInfos(
	sources: FlowSources,
): Record<string, ScheduleFlowInfo | null> {
	const flows = parsedFlows(sources);
	const infos: Record<string, ScheduleFlowInfo | null> = {};
	for (const name of Object.keys(flows)) {
		const file = sources[name];
		if (!file || !("json" in file)) {
			infos[name] = null;
			continue;
		}
		const loaded = parseFlow(file.json, { flows, name });
		infos[name] = loaded.flow
			? {
					inputs: loaded.flow.inputs,
					errorCount: loaded.issues.filter((i) => i.severity === "error")
						.length,
				}
			: null;
	}
	return infos;
}
