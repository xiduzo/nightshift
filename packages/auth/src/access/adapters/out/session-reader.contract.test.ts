import { createAuthSandbox } from "../../../testing/sandbox";
import { betterAuthSessionReader } from "./better-auth-session-reader";
import { inMemorySessionReader } from "./in-memory-session-reader";
import { sessionReaderContract } from "./session-reader.contract";

/**
 * The contract of `SessionReader`, on both adapters. The real side runs on
 * Better Auth over a fresh database.
 */

sessionReaderContract("in memory", async () => {
	const sessionReader = inMemorySessionReader();
	return {
		sessionReader,
		signIn: async () => ({
			personId: "ada",
			headers: sessionReader.signIn("ada"),
		}),
		close: async () => {},
	};
});

sessionReaderContract("over better-auth", async () => {
	const sandbox = await createAuthSandbox();
	return {
		sessionReader: betterAuthSessionReader(sandbox.auth),
		signIn: async () => {
			const { userId, headers } = await sandbox.signUp("Ada");
			return { personId: userId, headers };
		},
		close: async () => sandbox.cleanup(),
	};
});
