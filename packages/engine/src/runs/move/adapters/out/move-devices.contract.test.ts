import { Refusal } from "@nightshift/refusal";
import type { OwnDevice } from "../../../../contract";
import type { Device } from "../../../../device";
import { inMemoryMoveDevices } from "./in-memory-move-devices";
import { moveDevicesContract, type SuiteDevice } from "./move-devices.contract";
import {
	type PlacementMoveDevicesDeps,
	placementMoveDevices,
} from "./placement-move-devices";

/**
 * The contract of `MoveDevices`, on both adapters. The real side is the
 * adapter over the planner of the peers (`PlacementPort`). `devices`
 * gives it in a daemon: here a planner in memory answers as that one does
 * (`devices/src/placement/placement.ts`), from a list of Devices.
 */

moveDevicesContract("in memory", async () => {
	const devices = inMemoryMoveDevices();
	return {
		devices,
		async add(list) {
			for (const d of list) devices.add(d);
		},
		close: async () => {},
	};
});

moveDevicesContract("over the planner of the peers", async () => {
	const known: SuiteDevice[] = [];
	const ownOf = (personId: string): OwnDevice[] =>
		known
			.filter((d) => d.personId === personId)
			.map(({ personId: _, flowVersion: __, testRuns: ___, ...d }) => d);
	const planner: PlacementMoveDevicesDeps = {
		async moveTo(_run, actor, to) {
			const target = ownOf(actor.personId).find((d) => d.deviceId === to);
			if (!target || target.thisDevice) return null;
			if (!target.online) {
				throw new Refusal(
					"unavailable",
					`${target.name} is offline. Move the run when it is online.`,
				);
			}
			return { id: target.deviceId, name: target.name };
		},
		deviceById(id) {
			const d = known.find((k) => k.deviceId === id);
			// Only what a move asks of a Device: what it says it walks.
			return {
				capabilities: async () => ({
					...(d?.flowVersion !== undefined
						? { flowVersion: d.flowVersion }
						: {}),
					...(d?.testRuns !== undefined ? { testRuns: d.testRuns } : {}),
				}),
			} as unknown as Device;
		},
		devicesFor: async (_spaceId, personId) => ownOf(personId),
	};
	return {
		devices: placementMoveDevices(planner),
		async add(list) {
			known.push(...list);
		},
		close: async () => {},
	};
});
