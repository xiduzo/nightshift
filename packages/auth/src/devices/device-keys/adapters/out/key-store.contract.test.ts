import { apikey } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { drizzleKeyStore } from "./drizzle-key-store";
import { inMemoryKeyStore } from "./in-memory-key-store";
import { keyStoreContract } from "./key-store.contract";

/** The contract of `KeyStore`, on both adapters. The real one runs on libsql in memory. */

keyStoreContract("in memory", async () => {
	const keyStore = inMemoryKeyStore();
	return {
		keyStore,
		add: async (hash, key) => keyStore.add(hash, { ...key }),
		close: async () => {},
	};
});

keyStoreContract("over drizzle", async () => {
	const db = await migratedDb();
	return {
		keyStore: drizzleKeyStore(db),
		async add(hash, key) {
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
		},
		close: async () => {},
	};
});
