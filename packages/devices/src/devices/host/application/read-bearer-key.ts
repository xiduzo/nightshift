import type { DeviceKeyAccess } from "@nightshift/auth";
import type { DeviceKeys } from "./ports";

export type ReadBearerKeyPorts = {
	keys: Pick<DeviceKeys, "verify">;
	bearerOf(headers: Headers): string | null;
};

/** The Device key of a request (`Authorization: Bearer`), resolved. */
export const readBearerKey =
	(ports: ReadBearerKeyPorts) =>
	async (headers: Headers): Promise<DeviceKeyAccess | null> => {
		const key = ports.bearerOf(headers);
		return key ? ports.keys.verify(key) : null;
	};
