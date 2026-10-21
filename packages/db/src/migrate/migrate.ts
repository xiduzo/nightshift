import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/libsql/migrator";

import type { Database } from "../client";

/** The SQL migrations that drizzle-kit generates from the schema (`../schema`). */
export const migrationsFolder = fileURLToPath(
	new URL("./migrations", import.meta.url),
);

/**
 * Applies every pending migration. Safe to call on each start: applied
 * migrations are skipped. The daemon calls it before it creates the engine.
 */
export async function migrateDb(
	db: Database,
	options: { migrationsFolder?: string } = {},
): Promise<void> {
	await migrate(db, {
		migrationsFolder: options.migrationsFolder ?? migrationsFolder,
	});
}
