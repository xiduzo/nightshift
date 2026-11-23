import type { Database } from "@nightshift/db";
import type { DeviceDirectory } from "@nightshift/engine";
import { createHostSpaces } from "./links";
import { wireRegistry } from "./registry";

/**
 * The engine's `DeviceDirectory`, over the Device rows this package owns:
 * this computer's Device (`ensureSelfDevice`), the names of Devices, and the
 * Spaces a Host keeps (`host_space`). The daemon gives it to the Space
 * documents, and `createPeerEngine` to the engine.
 */
export function deviceDirectory(db: Database): DeviceDirectory {
	const hostSpaces = createHostSpaces(db);
	const registry = wireRegistry({ db });
	return {
		selfId: async () => (await registry.ensureSelfDevice()).id,
		selfOwnerId: () => registry.readSelfOwner(),
		names: (ids) => registry.listDeviceNames({ ids }),
		known: () => registry.listKnownDevices(),
		hostedElsewhere: async (spaceId) =>
			(await hostSpaces.hostOf(spaceId)) !== null,
		hostOf: (spaceId) => hostSpaces.hostOf(spaceId),
	};
}
