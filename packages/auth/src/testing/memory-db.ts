import type { Database } from "@nightshift/db";
import { member, organization, user } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";

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
