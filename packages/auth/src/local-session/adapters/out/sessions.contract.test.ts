import { now } from "@nightshift/time";
import { localPerson } from "../../../spaces";
import { createAuthSandbox } from "../../../testing/sandbox";
import { betterAuthSessions } from "./better-auth-sessions";
import { inMemorySessions } from "./in-memory-sessions";
import { sessionsContract } from "./sessions.contract";

/**
 * The contract of `Sessions`, on both adapters. The real side runs on
 * Better Auth over a fresh database, with this computer's Person.
 */

sessionsContract("in memory", async () => {
	const sessions = inMemorySessions();
	sessions.now = 1_000;
	return {
		sessions,
		personId: "ada",
		personOf: (session) => session.user.id,
		now: () => sessions.now,
		close: async () => {},
	};
});

sessionsContract("over better-auth", async () => {
	const sandbox = await createAuthSandbox();
	const person = await localPerson(sandbox.db);
	return {
		sessions: betterAuthSessions(sandbox.auth, sandbox.db),
		personId: person.userId,
		personOf: (session) => session.user.id,
		now,
		close: async () => sandbox.cleanup(),
	};
});
