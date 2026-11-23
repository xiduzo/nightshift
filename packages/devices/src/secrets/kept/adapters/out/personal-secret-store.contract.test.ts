import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { drizzlePersonalSecretStore } from "./drizzle-personal-secret-store";
import { inMemoryPersonalSecretStore } from "./in-memory-personal-secret-store";
import { personalSecretStoreContract } from "./personal-secret-store.contract";
import { webcryptoSecretsCipher } from "./webcrypto-secrets-cipher";

/** The contract of `PersonalSecretStore`, on both adapters. The real one runs on libsql in memory. */

personalSecretStoreContract("in memory", async (now) => ({
	personalSecretStore: inMemoryPersonalSecretStore(now),
}));

personalSecretStoreContract("over drizzle", async (now) => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const cipher = webcryptoSecretsCipher(
		"a-secrets-key-for-these-tests-0123456789",
	);
	return {
		personalSecretStore: drizzlePersonalSecretStore({ db, cipher, now }),
	};
});
