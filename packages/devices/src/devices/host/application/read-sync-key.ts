import type { SyncDeviceKey } from "@nightshift/auth";
import { keyOfDocumentToken } from "../../../contract";
import type { DeviceKeys, HostSettings, Registry } from "./ports";

export type ReadSyncKeyPorts = {
	keys: Pick<DeviceKeys, "verify">;
	registry: Pick<Registry, "get">;
	settings: Pick<HostSettings, "isHost">;
};

/**
 * A Device key as the relay checks it: with `sync`, of a Device with
 * access. Null while Be a Host is off, for a key this Host does not take,
 * and for a Device of another version (`documentToken`): its link then
 * asks, and hears why.
 */
export const readSyncKey =
	(ports: ReadSyncKeyPorts) =>
	async (token: string): Promise<SyncDeviceKey | null> => {
		if (!ports.settings.isHost()) return null;
		const key = keyOfDocumentToken(token);
		const access = key === null ? null : await ports.keys.verify(key, "sync");
		if (!access) return null;
		const paired = await ports.registry.get(access.deviceId);
		if (!paired || paired.revokedAt) return null;
		return {
			deviceId: access.deviceId,
			personId: access.personId,
			home: paired.homeHost !== null,
		};
	};
