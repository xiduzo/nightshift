import type { Database } from "@nightshift/db";
import { invitation, member, organization, user } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import type { MembersSeed } from "./adapters/out/in-memory-person-store";

/**
 * The real side of the contract suites of members: a database in memory,
 * and the rows a test puts on it before it asks a store.
 */

/**
 * A migrated database in memory, without the local Person and the
 * personal Space that the migrations make: an empty Replica.
 */
export async function memoryDb(): Promise<Database> {
	const db = await migratedDb();
	await db.delete(member);
	await db.delete(organization);
	await db.delete(user);
	return db;
}

/** Puts rows on the database, as `seedRecords` puts them on the in-memory Replica. */
export function drizzleMembersSeed(db: Database): MembersSeed {
	return {
		async person(person) {
			await db.insert(user).values({
				id: person.id,
				name: person.name,
				email: person.email,
				role: person.role ?? null,
			});
		},
		async space(space) {
			await db.insert(organization).values({
				id: space.id,
				name: space.name,
				slug: space.id,
				createdAt: asDate(0),
			});
		},
		async membership(row) {
			await db.insert(member).values({
				id: row.id,
				organizationId: row.spaceId,
				userId: row.personId,
				role: row.role,
				createdAt: asDate(row.createdAt),
			});
		},
		async invitation(row) {
			await db.insert(invitation).values({
				id: row.id,
				organizationId: row.spaceId,
				email: row.email,
				role: row.role,
				status: row.status,
				expiresAt: asDate(row.expiresAt),
				inviterId: row.inviterId,
				createdAt: asDate(row.createdAt),
			});
		},
	};
}
