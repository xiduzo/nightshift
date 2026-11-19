import type { FlowNode } from "@nightshift/flows";
import type { NodeToPlace, OwnDevice, Placement } from "../../../../contract";
import type { Device } from "../../../../device";
import type { PlanInput, PlannedRun } from "../../../../placement";
import type { RunPlanner } from "../../application/ports";

/**
 * The planner of the start in memory. A test says what the plan of a run
 * is (`planWith`), which Device misfits its nodes (`unfit`), the Devices
 * a person chooses from (`offer`) and a project's latest run (`ranOn`). It
 * records what it was asked.
 */
export function inMemoryRunPlanner() {
	let planOf:
		| ((input: Omit<PlanInput, "lastRun">) => Promise<PlannedRun>)
		| null = null;
	const misfits = new Map<string, string>();
	const lastRuns = new Map<string, string>();
	let placements: Placement[] = [];
	let devices: OwnDevice[] = [];

	const twin = {
		/** Every plan that was asked for, in order. */
		planned: [] as Omit<PlanInput, "lastRun">[],
		/** The Devices whose fit was asked, by id, in order. */
		fitted: [] as string[],
		/** Every list of Devices that was asked for, in order. */
		listed: [] as {
			spaceId: string;
			personId: string;
			projectId: string;
			forNode?: NodeToPlace;
		}[],
		/** From now on a plan is what `plan` gives, or what it throws. */
		planWith(plan: (input: Omit<PlanInput, "lastRun">) => Promise<PlannedRun>) {
			planOf = plan;
		},
		/** From now on the Device of that id misfits any nodes, with these words. */
		unfit(deviceId: string, words: string) {
			misfits.set(deviceId, words);
		},
		/** The Devices a person chooses from, and the Devices they may place a step on. */
		offer(list: { placements?: Placement[]; devices?: OwnDevice[] }) {
			placements = list.placements ?? placements;
			devices = list.devices ?? devices;
		},
		/** The project's latest run ran on that Device. */
		ranOn(projectId: string, deviceId: string) {
			lastRuns.set(projectId, deviceId);
		},

		async plan(input: Omit<PlanInput, "lastRun">) {
			twin.planned.push(input);
			if (!planOf) throw new Error("The test planned no run.");
			return planOf(input);
		},
		async misfit(_nodes: readonly FlowNode[], device: Device) {
			twin.fitted.push(device.id);
			return misfits.get(device.id) ?? null;
		},
		async placements(spaceId: string, personId: string, projectId: string) {
			twin.listed.push({ spaceId, personId, projectId });
			return placements.map((p) => ({ ...p }));
		},
		async devicesFor(
			spaceId: string,
			personId: string,
			projectId: string,
			forNode?: NodeToPlace,
		) {
			twin.listed.push({
				spaceId,
				personId,
				projectId,
				...(forNode ? { forNode } : {}),
			});
			return devices.map((d) => ({ ...d }));
		},
		async lastRunDevice(projectId: string) {
			return lastRuns.get(projectId) ?? null;
		},
	};
	return twin satisfies RunPlanner;
}

export type InMemoryRunPlanner = ReturnType<typeof inMemoryRunPlanner>;
