import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";

import { createDb, type Database } from "../client";
import { migrateDb } from "../migrate";

const UUID =
	/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;

/** Bun gives each test file its own modules, so the text is on the process. */
const kept = globalThis as {
	__nightshiftMigratedText?: Promise<string>;
};

/**
 * A new database as `migrateDb` leaves it, in memory unless a test names a
 * file. The migrations run once in a process. Each later database gets what
 * they made as one text, with ids of its own in the rows that they made: the
 * Device, its Person and the personal Space. The journal comes with it, so a
 * later `migrateDb` applies nothing.
 */
export async function migratedDb(databaseUrl = ":memory:"): Promise<Database> {
	kept.__nightshiftMigratedText ??= migratedText();
	const text = withNewIds(await kept.__nightshiftMigratedText);
	const db = createDb({ DATABASE_URL: databaseUrl });
	await db.$client.executeMultiple(text);
	return db;
}

/** Everything in a migrated database, as SQL that makes it again. */
async function migratedText(): Promise<string> {
	const db = createDb({ DATABASE_URL: ":memory:" });
	try {
		await migrateDb(db);
		const objects = await db.all<{ type: string; name: string; sql: string }>(
			sql`SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid`,
		);
		// SQLite makes its own table, the counters of AUTOINCREMENT, from the rows.
		const made = objects.filter((object) => !object.name.startsWith("sqlite_"));
		const rows: string[] = [];
		for (const { type, name } of made) {
			if (type === "table") rows.push(...(await inserts(db, name)));
		}
		return [
			"BEGIN",
			"PRAGMA defer_foreign_keys = ON",
			...made.map((object) => object.sql),
			...rows,
			"COMMIT",
		].join(";\n");
	} finally {
		db.$client.close();
	}
}

async function inserts(db: Database, table: string): Promise<string[]> {
	const columns = await db.all<{ name: string }>(
		sql.raw(`PRAGMA table_info("${table}")`),
	);
	const values = columns.map(({ name }) => `quote("${name}")`);
	const rows = await db.all<{ row: string }>(
		sql.raw(
			`SELECT ${values.join(" || ', ' || ")} AS row FROM "${table}" ORDER BY rowid`,
		),
	);
	return rows.map(({ row }) => `INSERT INTO "${table}" VALUES (${row})`);
}

function withNewIds(text: string): string {
	const ids = new Map<string, string>();
	return text.replace(UUID, (id) => {
		const known = ids.get(id) ?? randomUUID();
		ids.set(id, known);
		return known;
	});
}
