import { user } from "@nightshift/db/schema";
import { createAuthSandbox } from "../../../../testing/sandbox";
import { betterAuthCredentials } from "./better-auth-credentials";
import { credentialsContract } from "./credentials.contract";
import { inMemoryCredentials } from "./in-memory-credentials";

/**
 * The contract of `Credentials`, on both adapters. The real side runs on
 * Better Auth over a fresh database.
 */

credentialsContract("in memory", async () => {
	const credentials = inMemoryCredentials();
	return {
		credentials,
		addPerson: async (person) => credentials.add(person),
		close: async () => {},
	};
});

credentialsContract("over better-auth", async () => {
	const sandbox = await createAuthSandbox();
	return {
		credentials: betterAuthCredentials(sandbox.auth, sandbox.db),
		async addPerson(person) {
			await sandbox.db
				.insert(user)
				.values({ id: person.id, name: person.id, email: person.email });
		},
		close: async () => sandbox.cleanup(),
	};
});
