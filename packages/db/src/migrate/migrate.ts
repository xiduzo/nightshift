import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { iso, now } from "@nightshift/time";
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
 * The migration that gives each run end logged without a code its code,
 * and takes `by` out of each removal of a run's files. It changes events,
 * so a copy of the database comes first.
 */
const RUN_END_CODES = "20261127112537_run_end_codes";

/**
 * Applies every pending migration. Safe to call on each start: applied
 * migrations are skipped. The daemon calls it before it creates the engine.
 * When it applies the migration of left Spaces, it logs how many rows that
 * migration added, if any. Before it applies the migration of run end
 * codes to events it would change, it copies the database to `backups/`
 * beside it, and then logs how many events changed and where the copy is.
 */
export async function migrateDb(
	db: Database,
	options: { migrationsFolder?: string } = {},
): Promise<void> {
	const before = await appliedMigrations(db);
	const endCodes = before.has(RUN_END_CODES)
		? null
		: await eventsWithoutCodes(db);
	const copy =
		endCodes && endCodes.ends + endCodes.removals > 0
			? await copyDatabase(db, "run-end-codes")
			: null;
	await migrate(db, {
		migrationsFolder: options.migrationsFolder ?? migrationsFolder,
	});
	const after = await appliedMigrations(db);
	if (endCodes && copy !== null && after.has(RUN_END_CODES)) {
		console.info(
			`Migration ${RUN_END_CODES}: gave ${endCodes.ends} run ends their code and took who removed them out of ${endCodes.removals} removals of run files. The copy of the database: ${copy}`,
		);
	}
	if (before.has(LEFT_SPACES) || !after.has(LEFT_SPACES)) return;
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

/**
 * The events the migration of run end codes changes: run ends without a
 * code, and removals of run files that say who removed them. The same
 * conditions as its SQL. None in a database without events yet.
 */
async function eventsWithoutCodes(
	db: Database,
): Promise<{ ends: number; removals: number }> {
	const [table] = await db.all<{ name: string }>(
		sql.raw(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event'",
		),
	);
	if (!table) return { ends: 0, removals: 0 };
	const [found] = await db.all<{
		ends: number | null;
		removals: number | null;
	}>(
		sql.raw(
			"SELECT sum(type = 'RunEnded' AND json_type(payload, '$.endReason') IS NULL) AS ends, sum(type = 'WorktreeRemoved' AND json_type(payload, '$.by') IS NOT NULL) AS removals FROM event WHERE type IN ('RunEnded', 'WorktreeRemoved') AND json_valid(payload)",
		),
	);
	return { ends: found?.ends ?? 0, removals: found?.removals ?? 0 };
}

/**
 * A copy of the whole database in `backups/` beside its file, made in one
 * statement (`VACUUM INTO`) through the client of this process. Returns
 * its path. A database in memory has no file to copy beside: it says so.
 */
async function copyDatabase(db: Database, before: string): Promise<string> {
	const [main] = await db.all<{ name: string; file: string | null }>(
		sql.raw("PRAGMA database_list"),
	);
	if (!main?.file) return "none, the database is not a file";
	const folder = join(dirname(main.file), "backups");
	await mkdir(folder, { recursive: true });
	const stamp = iso(now()).replace(/[:.]/g, "-");
	const path = join(folder, `before-${before}-${stamp}.db`);
	await db.run(sql.raw(`VACUUM INTO '${path.replaceAll("'", "''")}'`));
	const copy = await stat(path).catch(() => null);
	if (!copy || copy.size === 0) {
		throw new Error(`The copy of the database at ${path} was not made.`);
	}
	return path;
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
