import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, type Database } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";

/** A migrated database in a new temporary folder, and how to remove it. */
export async function testDatabase(): Promise<{
	db: Database;
	cleanup(): void;
}> {
	const root = mkdtempSync(join(tmpdir(), "nightshift-notifications-"));
	const db = createDb({ DATABASE_URL: `file:${join(root, "nightshift.db")}` });
	await migrateDb(db);
	return { db, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
