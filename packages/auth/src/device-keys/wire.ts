import { defaultKeyHasher } from "@better-auth/api-key";
import type { Database } from "@nightshift/db";
import { now } from "@nightshift/time";
import type { Auth } from "../auth";
import { betterAuthKeyIssuer } from "./adapters/out/better-auth-key-issuer";
import { drizzleKeyStore } from "./adapters/out/drizzle-key-store";
import { issueKey } from "./application/issue-key";
import { revokeKeys } from "./application/revoke-keys";
import { verifyKey } from "./application/verify-key";
import {
	createVerifiedKeys,
	DEFAULT_DEVICE_KEY_IDLE_DAYS,
	type DeviceKeyAccess,
	type DeviceKeyPermission,
} from "./domain/device-keys";

/**
 * The wiring of device-keys: the one place that builds its real adapters
 * and binds each use case to its ports. One wire is one Host's keys: it
 * makes the one memory of the keys checked lately.
 */

/** What the package gives device-keys: what the real adapters stand on. */
export type DeviceKeysDeps = {
	auth: Auth;
	db: Database;
	/** How many days a key may go unused. Read on every issue and use. */
	idleDays?: () => number;
};

/** The Device keys of this Host: the use cases of device-keys, bound to their ports. */
export type DeviceKeys = {
	/**
	 * A new key for the Device, bound to the Person (`issueKey`). The
	 * Device's earlier keys on this Host stop working. The key is returned
	 * once and never stored in the clear.
	 */
	issue(input: {
		personId: string;
		deviceId: string;
		deviceName: string;
	}): Promise<{ key: string; keyId: string }>;
	/**
	 * The key's Device and owner, when the key is valid and allows `need`
	 * (`verifyKey`). Null for anything else: unknown, expired, revoked, or
	 * not a Device key.
	 */
	verify(
		key: string,
		need?: DeviceKeyPermission,
	): Promise<DeviceKeyAccess | null>;
	/** Deletes every key of the Device (`revokeKeys`). Its next call is refused. */
	revoke(deviceId: string): Promise<void>;
};

export function wireDeviceKeys(deps: DeviceKeysDeps): DeviceKeys {
	const ports = {
		keyStore: drizzleKeyStore(deps.db),
		keyIssuer: betterAuthKeyIssuer(deps.auth),
		verified: createVerifiedKeys(),
		hash: defaultKeyHasher,
		idleDays: () => deps.idleDays?.() ?? DEFAULT_DEVICE_KEY_IDLE_DAYS,
		now,
	};
	const revoke = revokeKeys(ports);
	const issue = issueKey({ ...ports, revokeKeys: revoke });
	const verify = verifyKey(ports);
	return {
		issue,
		verify: (key, need) => verify(need ? { key, need } : { key }),
		revoke: (deviceId) => revoke({ deviceId }),
	};
}
