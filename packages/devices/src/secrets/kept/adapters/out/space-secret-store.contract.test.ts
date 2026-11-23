import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { drizzleSpaceSecretStore } from "./drizzle-space-secret-store";
import { inMemorySpaceSecretStore } from "./in-memory-space-secret-store";
import { spaceSecretStoreContract } from "./space-secret-store.contract";
import { webcryptoSecretsCipher } from "./webcrypto-secrets-cipher";

/** The contract of `SpaceSecretStore`, on both adapters. The real one runs on libsql in memory. */

spaceSecretStoreContract("in memory", async (now) => ({
	spaceSecretStore: inMemorySpaceSecretStore(now),
}));

spaceSecretStoreContract("over drizzle", async (now) => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const cipher = webcryptoSecretsCipher(
		"a-secrets-key-for-these-tests-0123456789",
	);
	return { spaceSecretStore: drizzleSpaceSecretStore({ db, cipher, now }) };
});
