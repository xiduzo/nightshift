import { type PairedDevice, toPaired } from "../domain/paired-device";
import type { DeviceStore } from "./ports";

export type ListDevicesPorts = {
	store: Pick<DeviceStore, "ownedBy">;
	/** The Devices online now (`DevicePresence`). */
	online: ReadonlyMap<string, number>;
};

/** What the request asks for: the owner of the Devices. */
export type ListDevices = { ownerId: string };

/**
 * The Person's paired Devices, revoked ones last.
 *
 * The Host and the peers ask it: the use case takes the request alone.
 */
export const listDevices =
	(ports: ListDevicesPorts) =>
	async (request: ListDevices): Promise<PairedDevice[]> =>
		(await ports.store.ownedBy(request.ownerId)).map((row) =>
			toPaired(row, ports.online),
		);
