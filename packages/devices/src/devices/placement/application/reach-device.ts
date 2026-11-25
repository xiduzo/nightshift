import type { Device, PlacedRun } from "@nightshift/engine";

import type { OtherDevices, ThisComputer } from "./ports";

export type ReachDevicePorts = {
	here: Pick<ThisComputer, "device" | "deviceFor">;
	others: Pick<OtherDevices, "at" | "withoutStarter">;
};

/** Gives a Device of a run by id, as the run reaches it: this computer, or another Device of its plan over the work relay, named as the caller says, else as the plan does. A run with no starter reaches none. */
export function reachDevice({ here, others }: ReachDevicePorts) {
	return (id: string, run: PlacedRun, name?: string): Device => {
		if (id === here.device.id || id === run.walkerId) {
			return here.deviceFor(run);
		}
		const { plan } = run;
		const device = {
			id,
			name: name ?? plan.devices[id]?.name ?? "The device of this step",
		};
		const forRun = {
			spaceId: run.spaceId,
			projectId: run.projectId,
			personId: plan.personId ?? "",
			runId: run.id,
		};
		return plan.personId === null
			? others.withoutStarter(device, forRun)
			: others.at(device, forRun);
	};
}
