import type { SyncDeviceKey } from "@nightshift/auth";
import type { DeviceKeys, HostSettings, Registry } from "./ports";

export type ReadSyncKeyPorts = {
	keys: Pick<DeviceKeys, "verify">;
	registry: Pick<Registry, "get">;
	settings: Pick<HostSettings, "isHost">;
};

/**
 * A Device key as the relay checks it: with `sync`, of a Device with
 * access. Null while Be a Host is off, or for a key this Host does not
 * take.
 */
export const readSyncKey =
	(ports: ReadSyncKeyPorts) =>
	async (token: string): Promise<SyncDeviceKey | null> => {
		if (!ports.settings.isHost()) return null;
		const access = await ports.keys.verify(token, "sync");
		if (!access) return null;
		const paired = await ports.registry.get(access.deviceId);
		if (!paired || paired.revokedAt) return null;
		return {
			deviceId: access.deviceId,
			personId: access.personId,
			home: paired.homeHost !== null,
		};
	};
