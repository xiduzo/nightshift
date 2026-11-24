import { session, user } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { drizzleSessionStore } from "./drizzle-session-store";
import { inMemorySessionStore } from "./in-memory-session-store";
import { sessionStoreContract } from "./session-store.contract";

/** The contract of `SessionStore`, on both adapters. The real one runs on libsql in memory. */

sessionStoreContract("in memory", async () => {
	const sessionStore = inMemorySessionStore();
	return {
		sessionStore,
		addSession: async (record) => sessionStore.add(record),
		close: async () => {},
	};
});

sessionStoreContract("over drizzle", async () => {
	const db = await migratedDb();
	const people = new Set<string>();
	return {
		sessionStore: drizzleSessionStore(db),
		async addSession(record) {
			if (!people.has(record.personId)) {
				people.add(record.personId);
				await db.insert(user).values({
					id: record.personId,
					name: record.personId,
					email: `${record.personId}@example.com`,
				});
			}
			await db.insert(session).values({
				id: record.id,
				token: `token-${record.id}`,
				userId: record.personId,
				expiresAt: asDate(record.expiresAt),
				updatedAt: asDate(record.expiresAt),
			});
		},
		close: async () => {},
	};
});
