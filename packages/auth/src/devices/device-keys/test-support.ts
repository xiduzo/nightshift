import type { Database } from "@nightshift/db";
import { apikey } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { eq } from "drizzle-orm";
import { drizzleKeyStore } from "./adapters/out/drizzle-key-store";
import { inMemoryKeyIssuer } from "./adapters/out/in-memory-key-issuer";
import type { KeyStore } from "./application/ports";
import { revokeKeys } from "./application/revoke-keys";
import { createVerifiedKeys, type StoredKey } from "./domain/device-keys";

/** Puts keys on the database, each under its hash. */
export function keySeed(db: Database) {
	return async (hash: string, key: StoredKey): Promise<void> => {
		const at = asDate(0);
		await db.insert(apikey).values({
			id: key.id,
			referenceId: key.personId,
			key: hash,
			enabled: key.enabled,
			expiresAt: key.expiresAt === null ? null : asDate(key.expiresAt),
			permissions: JSON.stringify(key.permissions),
			metadata: JSON.stringify({ deviceId: key.deviceId }),
			createdAt: at,
			updatedAt: at,
		});
	};
}

/**
 * Every port of device-keys: the key store over a database in memory, which
 * counts its `reads` and `writes`, and the issuer in memory. The issuer
 * hashes a key as `hash-<key>`. The clock is `clock.now`. `revokeKeys` is
 * bound to the same ports, as the wire binds it.
 */
export async function deviceKeysPorts() {
	const db = await migratedDb();
	const clock = { now: 1_000_000 };
	const store = drizzleKeyStore(db);
	const counts = { reads: 0, writes: 0 };
	const reading =
		<A extends unknown[], T>(call: (...args: A) => Promise<T>) =>
		(...args: A) => {
			counts.reads += 1;
			return call(...args);
		};
	const writing =
		<A extends unknown[], T>(call: (...args: A) => Promise<T>) =>
		(...args: A) => {
			counts.writes += 1;
			return call(...args);
		};
	const keyStore: KeyStore = {
		find: reading(store.find),
		idsOfDevice: reading(store.idsOfDevice),
		remove: writing(store.remove),
		removeAll: writing(store.removeAll),
		setExpiry: writing(store.setExpiry),
	};
	const ports = {
		keyStore,
		keyIssuer: inMemoryKeyIssuer({ add: keySeed(db) }, () => clock.now),
		verified: createVerifiedKeys(),
		hash: async (key: string) => `hash-${key}`,
		idleDays: () => 30,
		now: () => clock.now,
	};
	return {
		...ports,
		clock,
		/** How often the key store was read and written. */
		counts,
		/** The key of that id, or null. Not counted. */
		async byId(keyId: string): Promise<StoredKey | null> {
			const [row] = await db
				.select({ hash: apikey.key })
				.from(apikey)
				.where(eq(apikey.id, keyId));
			return row ? store.find(row.hash) : null;
		},
		/** Gives the key of that id other permissions. */
		async allow(keyId: string, permissions: StoredKey["permissions"]) {
			await db
				.update(apikey)
				.set({ permissions: JSON.stringify(permissions) })
				.where(eq(apikey.id, keyId));
		},
		/** Sets when the key of that id expires. Not counted. */
		expire: (keyId: string, at: number) => store.setExpiry(keyId, at),
		revokeKeys: revokeKeys(ports),
	};
}
