import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { drizzleProjectSecretStore } from "./drizzle-project-secret-store";
import { inMemoryProjectSecretStore } from "./in-memory-project-secret-store";
import { projectSecretStoreContract } from "./project-secret-store.contract";
import { webcryptoSecretsCipher } from "./webcrypto-secrets-cipher";

/** The contract of `ProjectSecretStore`, on both adapters. The real one runs on libsql in memory. */

projectSecretStoreContract("in memory", async (now) => ({
	projectSecretStore: inMemoryProjectSecretStore(now),
}));

projectSecretStoreContract("over drizzle", async (now) => {
	const db = createDb({ DATABASE_URL: ":memory:" });
	await migrateDb(db);
	const cipher = webcryptoSecretsCipher(
		"a-secrets-key-for-these-tests-0123456789",
	);
	return { projectSecretStore: drizzleProjectSecretStore({ db, cipher, now }) };
});
