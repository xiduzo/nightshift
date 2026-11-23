import type { DeviceStore } from "./ports";

export type ListKnownDevicesPorts = { store: Pick<DeviceStore, "known"> };

/**
 * Every Device row whose access is not removed, with its owner
 * (`DeviceDirectory.known`).
 *
 * The engine asks it: the use case takes no request.
 */
export const listKnownDevices =
	(ports: ListKnownDevicesPorts) =>
	async (): Promise<{ id: string; name: string; ownerId: string | null }[]> =>
		ports.store.known();
