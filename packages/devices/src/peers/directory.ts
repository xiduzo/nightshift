import type { Database } from "@nightshift/db";
import type { DeviceDirectory } from "@nightshift/engine";
import { createHostSpaces } from "../links";
import { deviceNamesOf, selfDevice, selfOwnerId } from "../registry";

/**
 * The engine's `DeviceDirectory`, over the Device rows this package owns:
 * this computer's Device (`selfDevice`), the names of Devices, and the
 * Spaces a Host keeps (`host_space`). The daemon gives it to the Space
 * documents, and `createPeerEngine` to the engine.
 */
export function deviceDirectory(db: Database): DeviceDirectory {
	const hostSpaces = createHostSpaces(db);
	return {
		selfId: async () => (await selfDevice(db)).id,
		selfOwnerId: () => selfOwnerId(db),
		names: (ids) => deviceNamesOf(db, ids),
		hostedElsewhere: async (spaceId) =>
			(await hostSpaces.hostOf(spaceId)) !== null,
	};
}
