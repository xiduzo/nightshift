import { DAY_MS } from "@nightshift/time";
import {
	type DeviceKeyAccess,
	type DeviceKeyPermission,
	isDeviceKey,
	keyAllows,
	movedExpiry,
	type Verified,
	type VerifiedKeys,
} from "../domain/device-keys";
import type { KeyStore } from "./ports";

export type VerifyKeyPorts = {
	keyStore: Pick<KeyStore, "find" | "remove" | "setExpiry">;
	verified: Pick<VerifiedKeys, "fresh" | "keep" | "drop">;
	/** The hash a key is kept by (the API key plugin's). */
	hash: (key: string) => Promise<string>;
	/** How many days a key may go unused. Read on every use. */
	idleDays: () => number;
	now: () => number;
};

/** Which key, and what it must allow. */
export type VerifyKey = { key: string; need?: DeviceKeyPermission };

/**
 * The key's Device and owner, when the key is valid and allows `need`.
 * Null for anything else: unknown, expired, revoked, or not a Device key.
 * A valid key stays in memory for a minute. A use moves its expiry on, at
 * most once a day: the only write.
 */
export const verifyKey =
	(ports: VerifyKeyPorts) =>
	async (request: VerifyKey): Promise<DeviceKeyAccess | null> => {
		const { key, need } = request;
		if (!isDeviceKey(key)) return null;
		const hash = await ports.hash(key);
		const found = await lookup(ports, hash);
		if (!found) return null;
		const { keyId } = found.access;
		if (found.expiresAt !== null && found.expiresAt <= ports.now()) {
			// Past the idle time: refused, and gone, as the plugin does.
			ports.verified.drop(hash);
			await ports.keyStore.remove(keyId);
			return null;
		}
		if (need && !keyAllows(found.access.permissions, need)) return null;
		const next = movedExpiry(
			found.expiresAt,
			ports.now(),
			ports.idleDays() * DAY_MS,
		);
		if (next !== null) {
			await ports.keyStore.setExpiry(keyId, next);
			found.expiresAt = next;
		}
		return found.access;
	};

/** The key of that hash, from memory while it is fresh, else from its row. */
async function lookup(
	ports: Pick<VerifyKeyPorts, "keyStore" | "verified" | "now">,
	hash: string,
): Promise<Verified | null> {
	const kept = ports.verified.fresh(hash, ports.now());
	if (kept) return kept;
	const row = await ports.keyStore.find(hash);
	if (!row || row.enabled === false || !row.deviceId) return null;
	const found: Verified = {
		access: {
			keyId: row.id,
			deviceId: row.deviceId,
			personId: row.personId,
			permissions: row.permissions,
		},
		expiresAt: row.expiresAt,
		checkedAt: ports.now(),
	};
	ports.verified.keep(hash, found);
	return found;
}
