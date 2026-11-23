import { type PairedDevice, toPaired } from "../domain/paired-device";
import type { DeviceStore } from "./ports";

export type FindDevicePorts = {
	store: Pick<DeviceStore, "paired">;
	/** The Devices online now (`DevicePresence`). */
	online: ReadonlyMap<string, number>;
};

/** What the request asks for: the paired Device of this id. */
export type FindDevice = { id: string };

/**
 * A paired Device by its id, or null. Never this computer's own row.
 *
 * The Host and the peers ask it: the use case takes the request alone.
 */
export const findDevice =
	(ports: FindDevicePorts) =>
	async (request: FindDevice): Promise<PairedDevice | null> => {
		const found = await ports.store.paired(request.id);
		return found ? toPaired(found, ports.online) : null;
	};
