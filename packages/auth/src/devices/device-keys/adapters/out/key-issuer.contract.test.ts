import { defaultKeyHasher } from "@better-auth/api-key";
import { now } from "@nightshift/time";
import { createAuthSandbox } from "../../../../testing/sandbox";
import type { StoredKey } from "../../domain/device-keys";
import { betterAuthKeyIssuer } from "./better-auth-key-issuer";
import { drizzleKeyStore } from "./drizzle-key-store";
import { inMemoryKeyIssuer } from "./in-memory-key-issuer";
import { keyIssuerContract } from "./key-issuer.contract";

/**
 * The contract of `KeyIssuer`, on both adapters. The real side runs on
 * Better Auth over a fresh database, and reads the key back by its hash.
 */

keyIssuerContract("in memory", async () => {
	const keys = new Map<string, StoredKey>();
	const clock = { now: 1_000 };
	return {
		keyIssuer: inMemoryKeyIssuer(
			{
				add: async (hash, key) => {
					keys.set(hash, key);
				},
			},
			() => clock.now,
		),
		personId: "ada",
		stored: async (key) => keys.get(`hash-${key}`) ?? null,
		now: () => clock.now,
		close: async () => {},
	};
});

keyIssuerContract("over better-auth", async () => {
	const sandbox = await createAuthSandbox();
	const ada = await sandbox.signUp("Ada");
	const store = drizzleKeyStore(sandbox.db);
	return {
		keyIssuer: betterAuthKeyIssuer(sandbox.auth),
		personId: ada.userId,
		stored: async (key) => store.find(await defaultKeyHasher(key)),
		now,
		close: async () => sandbox.cleanup(),
	};
});
