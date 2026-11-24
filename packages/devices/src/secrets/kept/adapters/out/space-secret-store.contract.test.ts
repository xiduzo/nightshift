import { migratedDb } from "@nightshift/db/testing";
import { drizzleSpaceSecretStore } from "./drizzle-space-secret-store";
import { inMemorySpaceSecretStore } from "./in-memory-space-secret-store";
import { spaceSecretStoreContract } from "./space-secret-store.contract";
import { webcryptoSecretsCipher } from "./webcrypto-secrets-cipher";

/** The contract of `SpaceSecretStore`, on both adapters. The real one runs on libsql in memory. */

spaceSecretStoreContract("in memory", async (now) => ({
	spaceSecretStore: inMemorySpaceSecretStore(now),
}));

spaceSecretStoreContract("over drizzle", async (now) => {
	const db = await migratedDb();
	const cipher = webcryptoSecretsCipher(
		"a-secrets-key-for-these-tests-0123456789",
	);
	return { spaceSecretStore: drizzleSpaceSecretStore({ db, cipher, now }) };
});
