import { Refusal } from "@nightshift/refusal";
import { NOT_YOURS_HERE } from "../domain/words";
import type { DeviceKeys, Disconnect, Registry } from "./ports";

export type RevokeDevicePorts = {
	registry: Pick<Registry, "get" | "revoke">;
	keys: Pick<DeviceKeys, "revoke">;
	relay: Disconnect;
};

export type RevokeDevice = { personId: string; deviceId: string };

/**
 * The Person's own Device only. Its key goes, then its connections.
 */
export const revokeDevice =
	(ports: RevokeDevicePorts) =>
	async (request: RevokeDevice): Promise<void> => {
		const paired = await ports.registry.get(request.deviceId);
		if (!paired || paired.ownerId !== request.personId) {
			throw new Refusal("forbidden", NOT_YOURS_HERE);
		}
		await ports.keys.revoke(request.deviceId);
		await ports.registry.revoke(request.deviceId);
		ports.relay.disconnect(request.deviceId);
	};
