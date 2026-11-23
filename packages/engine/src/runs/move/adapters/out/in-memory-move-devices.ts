import { Refusal } from "@nightshift/refusal";
import type { OwnDevice } from "../../../../contract";
import { UNADVERTISED_FLOW_VERSION } from "../../../../graph";
import type { MoveDevices } from "../../application/ports";

/** A Device as the twin keeps it: whose it is, and what it says it walks. */
export type KeptDevice = OwnDevice & {
	/** The Person whose Device it is. */
	personId: string;
	/** The flow format it reads. Absent: it does not say. */
	flowVersion?: number;
	/** Whether it walks test runs. Absent: it does not say. */
	testRuns?: boolean;
};

/**
 * The Person's Devices in memory, as a planner answers for them. A test
 * adds Devices (`add`) and takes one offline (`offline`). A target is one
 * of the Person's own, not this computer: else null. One that is offline
 * is the planner's refusal, in the words of `devices`. It records each
 * target it was asked for.
 */
export function inMemoryMoveDevices() {
	const devices = new Map<string, KeptDevice>();

	const twin = {
		/** Every target asked for, in order. */
		asked: [] as { runId: string; personId: string; deviceId: string }[],
		/** Adds a Device, or changes it. */
		add(device: KeptDevice) {
			devices.set(device.deviceId, device);
		},
		/** The Device stops taking work. */
		offline(deviceId: string) {
			const device = devices.get(deviceId);
			if (device) devices.set(deviceId, { ...device, online: false });
		},

		async target(
			run: Parameters<MoveDevices["target"]>[0],
			person: Parameters<MoveDevices["target"]>[1],
			deviceId: string,
		) {
			twin.asked.push({ runId: run.id, personId: person.personId, deviceId });
			const device = devices.get(deviceId);
			if (!device || device.personId !== person.personId || device.thisDevice) {
				return null;
			}
			if (!device.online) {
				throw new Refusal(
					"unavailable",
					`${device.name} is offline. Move the run when it is online.`,
				);
			}
			return { id: device.deviceId, name: device.name };
		},
		async capabilities(target: { id: string; name: string }) {
			const device = devices.get(target.id);
			return {
				flowVersion: device?.flowVersion ?? UNADVERTISED_FLOW_VERSION,
				testRuns: device?.testRuns === true,
			};
		},
		async own(
			_run: Parameters<MoveDevices["own"]>[0],
			person: Parameters<MoveDevices["own"]>[1],
		): Promise<OwnDevice[]> {
			// Another Person's Device comes in through its Offers.
			return [...devices.values()]
				.filter((d) => d.personId === person.personId || d.offers !== undefined)
				.map(({ personId: _, flowVersion: __, testRuns: ___, ...d }) => d);
		},
	};
	return twin satisfies MoveDevices;
}

export type InMemoryMoveDevices = ReturnType<typeof inMemoryMoveDevices>;
