import {
	type DevicePresence,
	silentSince,
	spaceOfOwner,
} from "../domain/paired-device";
import type { DeviceFacts, DeviceStore, PersonalSpaces } from "./ports";

export type SweepPresencePorts = {
	store: Pick<DeviceStore, "paired">;
	facts: DeviceFacts;
	spaces: PersonalSpaces;
	/** The Devices online now: this use case changes it. */
	online: DevicePresence;
	now: () => number;
};

/** What the request asks for: how long a silent Device stays online. */
export type SweepPresence = { offlineAfterMs: number };

/**
 * `DeviceOffline` for each Device silent for longer than `offlineAfterMs`.
 *
 * The presence timer asks it: the use case takes the request alone.
 */
export const sweepPresence =
	(ports: SweepPresencePorts) =>
	async (request: SweepPresence): Promise<void> => {
		const { online } = ports;
		const cutoff = ports.now() - request.offlineAfterMs;
		for (const id of silentSince(online, cutoff)) {
			online.delete(id);
			const found = await ports.store.paired(id);
			if (!found) continue;
			await ports.facts.log({
				type: "DeviceOffline",
				payload: { deviceId: found.id },
				spaceId: await spaceOfOwner(ports.spaces.idOf, found.ownerId),
			});
		}
	};
