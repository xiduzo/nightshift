import type { DeviceStore } from "./ports";

export type ListDeviceNamesPorts = { store: Pick<DeviceStore, "names"> };

/** What the request asks for: the Devices to name. */
export type ListDeviceNames = { ids: readonly string[] };

/**
 * The names of these Devices (this computer's own too), by id. A Device
 * this Replica has no row of is missing. No ids: no read.
 *
 * The engine and the peers ask it: the use case takes the request alone.
 */
export const listDeviceNames =
	(ports: ListDeviceNamesPorts) =>
	async (request: ListDeviceNames): Promise<Map<string, string>> => {
		if (request.ids.length === 0) return new Map();
		return ports.store.names(request.ids);
	};
