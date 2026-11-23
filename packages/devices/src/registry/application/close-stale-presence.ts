import { type DevicePresence, spaceOfOwner } from "../domain/paired-device";
import type {
	DeviceFacts,
	DeviceHistory,
	DeviceStore,
	PersonalSpaces,
} from "./ports";

export type CloseStalePresencePorts = {
	store: Pick<DeviceStore, "pairedOwners">;
	history: Pick<DeviceHistory, "devicePresence">;
	facts: DeviceFacts;
	spaces: PersonalSpaces;
	/** The Devices online now, which a reload handed over. */
	online: DevicePresence;
};

/**
 * A Host that starts again starts with every Device offline: a Device
 * whose last word in the log was `DeviceOnline`, and that the registry
 * before a reload did not hand over as online, gets `DeviceOffline`.
 *
 * The registry asks it once, when it is made: the use case takes no request.
 */
export const closeStalePresence =
	(ports: CloseStalePresencePorts) => async (): Promise<void> => {
		const rows = await ports.store.pairedOwners();
		if (rows.length === 0) return;
		const last = await ports.history.devicePresence();
		for (const row of rows) {
			if (last.get(row.id) !== "DeviceOnline" || ports.online.has(row.id)) {
				continue;
			}
			await ports.facts.log({
				type: "DeviceOffline",
				payload: { deviceId: row.id },
				spaceId: await spaceOfOwner(ports.spaces.idOf, row.ownerId),
			});
		}
	};
