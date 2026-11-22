import {
	fillingFlowsOf,
	type KnowledgeSync,
	LAST_RUNS,
	NAMES_WAIT_MS,
	namesOthers,
	savedSchedules,
} from "../domain/syncs";
import type { SourcesSpace, Wait } from "./ports";

export type ListFillingFlowsPorts = {
	space: Pick<
		SourcesSpace,
		"flows" | "listSchedules" | "listRuns" | "listDevices"
	>;
	/** This computer: a source that reads a folder here syncs here. */
	device: { id: string; name: string };
	wait: Wait;
	now: () => number;
};

/** Which project's flows. */
export type ListFillingFlows = { projectId: string };

/**
 * The project's flows that fill or review the knowledge, by name, and what
 * each source's list says, with no reconcile: the flows first, then the
 * schedules, the latest runs and the names of the computers at once.
 *
 * The names of other computers only the Host may know: they are asked only
 * when a source names one, and a list that does not load in time names
 * none, because the page must not wait on it.
 *
 * It checks no role: the `Knowledge` door has no actor yet (E-doors adds it).
 */
export const listFillingFlows =
	(ports: ListFillingFlowsPorts) =>
	async ({
		projectId,
	}: ListFillingFlows): Promise<{
		syncs: KnowledgeSync[];
		reviews: string[];
	}> => {
		const { space, device } = ports;
		const now = ports.now();
		const flows = await space.flows.map(projectId);
		const [schedules, runs, names] = await Promise.all([
			savedSchedules(() => space.listSchedules(projectId)),
			space.listRuns({ projectId, limit: LAST_RUNS }),
			(async () => {
				const names = new Map([[device.id, device.name]]);
				if (!namesOthers(flows, device.id)) return names;
				const devices = await Promise.race([
					space.listDevices(projectId).catch(() => []),
					ports.wait.wait(NAMES_WAIT_MS).then(() => []),
				]);
				for (const { deviceId, name } of devices) names.set(deviceId, name);
				// This computer's own name, also where the Host knows another.
				names.set(device.id, device.name);
				return names;
			})(),
		]);
		return fillingFlowsOf({
			flows,
			schedules,
			runs,
			names,
			here: device.id,
			now,
		});
	};
