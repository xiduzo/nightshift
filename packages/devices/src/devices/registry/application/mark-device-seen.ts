import { type DevicePresence, spaceOfOwner } from "../domain/paired-device";
import type { DeviceFacts, DeviceStore, PersonalSpaces } from "./ports";

export type MarkDeviceSeenPorts = {
	store: Pick<DeviceStore, "markSeen">;
	facts: DeviceFacts;
	spaces: PersonalSpaces;
	/** The Devices online now: this use case changes it. */
	online: DevicePresence;
	now: () => number;
};

/** What the request asks for: the Device whose link answered. */
export type MarkDeviceSeen = { id: string };

/**
 * Its link answered: last seen now, and `DeviceOnline` when it was
 * offline. A Device this Host has no paired row of stays offline.
 *
 * The Host asks it: the use case takes the request alone.
 */
export const markDeviceSeen =
	(ports: MarkDeviceSeenPorts) =>
	async (request: MarkDeviceSeen): Promise<void> => {
		const { id } = request;
		const { online } = ports;
		const at = ports.now();
		const wasOnline = online.has(id);
		online.set(id, at);
		const updated = await ports.store.markSeen(id, at);
		if (!updated) {
			online.delete(id);
			return;
		}
		if (wasOnline) return;
		await ports.facts.log({
			type: "DeviceOnline",
			payload: { deviceId: updated.id },
			spaceId: await spaceOfOwner(ports.spaces.idOf, updated.ownerId),
		});
	};
