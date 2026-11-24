import type { Database } from "@nightshift/db";
import { session, user } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import { drizzleSessionStore } from "./adapters/out/drizzle-session-store";
import { inMemoryLoginPorts } from "./adapters/out/in-memory-neighbours";

/** Puts sessions on the database, each with its Person. */
export function sessionSeed(db: Database) {
	return async (record: {
		id: string;
		personId: string;
		expiresAt: number;
	}): Promise<void> => {
		const { id, personId } = record;
		await db
			.insert(user)
			.values({ id: personId, name: personId, email: `${personId}@x.org` })
			.onConflictDoNothing();
		await db.insert(session).values({
			id,
			token: `token-${id}`,
			userId: personId,
			expiresAt: asDate(record.expiresAt),
			updatedAt: asDate(record.expiresAt),
		});
	};
}

/** Every port of login: the sessions over a database in memory, the credentials in memory. */
export async function loginPorts() {
	const db = await migratedDb();
	return {
		...inMemoryLoginPorts(),
		sessionStore: drizzleSessionStore(db),
		addSession: sessionSeed(db),
	};
}
