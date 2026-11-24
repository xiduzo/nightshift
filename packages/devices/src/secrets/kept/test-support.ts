import { personalSecret } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { instant } from "@nightshift/time";
import { drizzlePersonalSecretStore } from "./adapters/out/drizzle-personal-secret-store";
import { drizzleProjectSecretStore } from "./adapters/out/drizzle-project-secret-store";
import { drizzleSpaceSecretStore } from "./adapters/out/drizzle-space-secret-store";
import { webcryptoSecretsCipher } from "./adapters/out/webcrypto-secrets-cipher";

/** A database in memory, and the real cipher with a key of a test: what the stores stand on. */
export async function keptGround() {
	return {
		db: await migratedDb(),
		cipher: webcryptoSecretsCipher("a-secrets-key-for-these-tests-0123456789"),
	};
}

/** The three stores over one database in memory, on a clock at 7. */
export async function keptStores() {
	const ground = { ...(await keptGround()), now: () => 7 };
	const { db } = ground;
	const personal = drizzlePersonalSecretStore(ground);
	return {
		personal,
		project: drizzleProjectSecretStore(ground),
		space: drizzleSpaceSecretStore(ground),
		/** What is kept of each Personal secret, with its opened value. */
		async personalRows() {
			const rows = await db.select().from(personalSecret);
			return Promise.all(
				rows.map(async ({ ownerId, name, setAt, setBy }) => ({
					ownerId,
					name,
					value: (await personal.values(ownerId, [name]))[name],
					setAt: instant(setAt),
					setBy,
				})),
			);
		},
	};
}
