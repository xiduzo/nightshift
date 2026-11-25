import type { Device, PlacedRun } from "@nightshift/engine";
import { NO_STARTER_RELAY } from "../domain/no-relay";
import type { OtherDevices, ThisComputer } from "./ports";

export type ReachDevicePorts = {
	here: Pick<ThisComputer, "device" | "deviceFor">;
	others: Pick<OtherDevices, "relay" | "over">;
};

/** Gives a Device of a run by id, as the run reaches it: this computer, or another Device of its plan over the work relay, named as the caller says, else as the plan does. A run with no starter reaches none. */
export function reachDevice({ here, others }: ReachDevicePorts) {
	return (id: string, run: PlacedRun, name?: string): Device => {
		if (id === here.device.id || id === run.walkerId) {
			return here.deviceFor(run);
		}
		const { plan } = run;
		return others.over(
			plan.personId === null ? NO_STARTER_RELAY : others.relay,
			{
				id,
				name: name ?? plan.devices[id]?.name ?? "The device of this step",
			},
			{
				spaceId: run.spaceId,
				projectId: run.projectId,
				personId: plan.personId ?? "",
				runId: run.id,
			},
		);
	};
}
