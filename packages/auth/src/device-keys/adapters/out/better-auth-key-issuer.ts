import type { Auth } from "../../../auth";
import type { KeyIssuer } from "../../application/ports";

/** `KeyIssuer` over the API key plugin's `createApiKey`. `wireDeviceKeys` builds it. */
export function betterAuthKeyIssuer(auth: Auth): KeyIssuer {
	return {
		async create(key) {
			const created = await auth.api.createApiKey({
				body: {
					userId: key.personId,
					name: key.name,
					metadata: { deviceId: key.deviceId },
					permissions: key.permissions,
					expiresIn: key.expiresIn,
				},
			});
			return { key: created.key, keyId: created.id };
		},
	};
}
