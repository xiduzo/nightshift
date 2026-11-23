import type { VerifiedKeys } from "../domain/device-keys";
import type { KeyStore } from "./ports";

export type RevokeKeysPorts = {
	keyStore: Pick<KeyStore, "idsOfDevice" | "removeAll">;
	verified: Pick<VerifiedKeys, "dropDevice">;
};

/** Whose keys. */
export type RevokeKeys = { deviceId: string };

/** Deletes every key of the Device, from memory at once. Its next call is refused. */
export const revokeKeys =
	(ports: RevokeKeysPorts) =>
	async (request: RevokeKeys): Promise<void> => {
		ports.verified.dropDevice(request.deviceId);
		const ids = await ports.keyStore.idsOfDevice(request.deviceId);
		if (ids.length > 0) await ports.keyStore.removeAll(ids);
	};
