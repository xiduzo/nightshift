import type { Database } from "@nightshift/db";
import { member, organization, user } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { asDate } from "@nightshift/time";
import type { RowBatch } from "./domain/personal-space";

/**
 * The real side of the contract suites of personal: a database in memory,
 * the rows a test puts on it, and how a row batch runs on it.
 */

/** What a test puts on a Replica before it asks a store. */
export type PersonalSeed = {
	person(person: { id: string; name: string; email: string }): Promise<void>;
	space(space: {
		id: string;
		name: string;
		slug: string;
		personal: boolean;
	}): Promise<void>;
	membership(membership: {
		id: string;
		spaceId: string;
		personId: string;
		role: string;
	}): Promise<void>;
};

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

/** Puts rows on the database. */
export function drizzlePersonalSeed(db: Database): PersonalSeed {
	return {
		async person(person) {
			await db.insert(user).values(person);
		},
		async space(space) {
			await db.insert(organization).values({ ...space, createdAt: asDate(0) });
		},
		async membership(row) {
			await db.insert(member).values({
				id: row.id,
				organizationId: row.spaceId,
				userId: row.personId,
				role: row.role,
				createdAt: asDate(0),
			});
		},
	};
}

/** Runs a row batch of the drizzle adapter as one `db.batch`. */
export async function runBatch(db: Database, rows: RowBatch): Promise<void> {
	await db.batch(rows as unknown as Parameters<Database["batch"]>[0]);
}
