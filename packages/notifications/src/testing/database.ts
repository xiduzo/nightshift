import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "@nightshift/db";
import { migratedDb } from "@nightshift/db/testing";

/** A migrated database in a new temporary folder, and how to remove it. */
export async function testDatabase(): Promise<{
	db: Database;
	cleanup(): void;
}> {
	const root = mkdtempSync(join(tmpdir(), "nightshift-notifications-"));
	const db = await migratedDb(`file:${join(root, "nightshift.db")}`);
	return { db, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
