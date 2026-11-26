import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";

import type { Database } from "../client";

/** The SQL migrations that drizzle-kit generates from the schema (`../schema`). */
export const migrationsFolder = fileURLToPath(
	new URL("./migrations", import.meta.url),
);

/** The migration that keeps a row for each Space this computer left. */
const LEFT_SPACES = "20261126093041_host_space_left";

/**
 * Applies every pending migration. Safe to call on each start: applied
 * migrations are skipped. The daemon calls it before it creates the engine.
 * When it applies the migration of left Spaces, it logs how many rows that
 * migration added, if any.
 */
export async function migrateDb(
	db: Database,
	options: { migrationsFolder?: string } = {},
): Promise<void> {
	const before = await appliedMigrations(db);
	await migrate(db, {
		migrationsFolder: options.migrationsFolder ?? migrationsFolder,
	});
	if (before.has(LEFT_SPACES)) return;
	if (!(await appliedMigrations(db)).has(LEFT_SPACES)) return;
	// No code wrote a left row before this migration: each one is its own.
	const [added] = await db.all<{ rows: number; unknown: number | null }>(
		sql.raw(
			"SELECT count(*) AS rows, sum(host_id = '') AS unknown FROM host_space WHERE left_at IS NOT NULL",
		),
	);
	if (!added?.rows) return;
	console.info(
		`Migration ${LEFT_SPACES}: added ${added.rows} rows for Spaces this computer left (${added.unknown ?? 0} with no known Host).`,
	);
}

/** The names of the migrations this database has, none before the first. */
async function appliedMigrations(db: Database): Promise<Set<string>> {
	const [table] = await db.all<{ name: string }>(
		sql.raw(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
		),
	);
	if (!table) return new Set();
	const rows = await db.all<{ name: string | null }>(
		sql.raw("SELECT name FROM __drizzle_migrations"),
	);
	return new Set(rows.flatMap((row) => (row.name ? [row.name] : [])));
}
