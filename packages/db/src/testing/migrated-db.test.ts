import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { now } from "@nightshift/time";
import { sql } from "drizzle-orm";

import { createDb, type Database } from "../client";
import { migrateDb } from "../migrate";
import { migratedDb } from "./migrated-db";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function newFile(): string {
	const root = mkdtempSync(join(tmpdir(), "nightshift-migrated-db-"));
	roots.push(root);
	return `file:${join(root, "nightshift.db")}`;
}

async function rows<T extends Record<string, unknown>>(
	db: Database,
	query: string,
): Promise<T[]> {
	return db.all<T>(sql.raw(query));
}

async function migrated(url: string): Promise<Database> {
	const db = createDb({ DATABASE_URL: url });
	await migrateDb(db);
	return db;
}

/**
 * Every object in the order of their making. Not the counters of
 * AUTOINCREMENT, which SQLite makes with the first table that asks one:
 * `contents` has their rows.
 */
const objects = (db: Database) =>
	rows(
		db,
		"SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name <> 'sqlite_sequence' ORDER BY rowid",
	);

/** Every row of every table, SQLite's own too. */
async function contents(db: Database) {
	const all: Record<string, Record<string, unknown>[]> = {};
	const tables = await rows<{ name: string }>(
		db,
		"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
	);
	for (const { name } of tables) {
		all[name] = await rows(db, `SELECT * FROM "${name}" ORDER BY rowid`);
	}
	return all;
}

const UUID = /[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}/g;

/** The instants and the ids, which differ per database: an id by its first place. */
function comparable(value: unknown): unknown {
	const ids: string[] = [];
	const text = JSON.stringify(value, (key, item: unknown) =>
		key === "applied_at" ||
		((key === "created_at" || key === "updated_at") && isNow(item))
			? "now"
			: item,
	);
	return JSON.parse(
		text.replace(UUID, (id) => {
			if (!ids.includes(id)) ids.push(id);
			return `id-${ids.indexOf(id)}`;
		}),
	);
}

/** The time of this test run, not the day that names a migration. */
const isNow = (item: unknown) =>
	typeof item === "number" && Math.abs(now() - item) < 10 * 60_000;

/** Each setting of the connection and the file that SQLite names. */
async function pragmas(db: Database) {
	const names = await rows<{ name: string }>(
		db,
		"SELECT DISTINCT name FROM pragma_pragma_list WHERE name NOT IN ('incremental_vacuum', 'optimize', 'shrink_memory', 'wal_checkpoint') ORDER BY name",
	);
	const all: Record<string, unknown> = {};
	for (const { name } of names) all[name] = await rows(db, `PRAGMA ${name}`);
	// Counts of the edits and pages of the making, the path of the file, and
	// the tables in no order: `objects` has them.
	for (const name of [
		"data_version",
		"schema_version",
		"page_count",
		"freelist_count",
		"database_list",
		"table_list",
	]) {
		delete all[name];
	}
	return all;
}

for (const [place, url] of [
	["in memory", () => ":memory:"],
	["in a file", newFile],
] as const) {
	describe(`migratedDb ${place}`, () => {
		test("has the objects, rows and settings that the migrations make", async () => {
			const real = await migrated(url());
			const db = await migratedDb(url());

			expect(await objects(db)).toEqual(await objects(real));
			expect(comparable(await contents(db))).toEqual(
				comparable(await contents(real)),
			);
			expect(await pragmas(db)).toEqual(await pragmas(real));
		});

		test("holds the rules of the schema", async () => {
			const db = await migratedDb(url());
			expect(await rows(db, "PRAGMA integrity_check")).toEqual([
				{ integrity_check: "ok" },
			]);
			expect(await rows(db, "PRAGMA foreign_key_check")).toEqual([]);
			await expect(
				rows(
					db,
					"INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m', 'none', 'none', 'owner', 1)",
				),
			).rejects.toThrow();
		});

		test("a later migrateDb applies nothing", async () => {
			const db = await migratedDb(url());
			const before = [await objects(db), await contents(db)];
			const version = await rows(db, "PRAGMA schema_version");
			await migrateDb(db);
			expect([await objects(db), await contents(db)]).toEqual(before);
			expect(await rows(db, "PRAGMA schema_version")).toEqual(version);
		});

		test("two databases share no row and no id", async () => {
			const one = await migratedDb(url());
			const two = await migratedDb(url());
			const idsOf = async (db: Database) =>
				JSON.stringify(await contents(db)).match(UUID) ?? [];
			const ids = await idsOf(one);
			expect(new Set(ids).size).toBe(4);
			const others = new Set(await idsOf(two));
			expect(ids.filter((id) => others.has(id))).toEqual([]);

			await rows(one, "DELETE FROM device");
			expect(await rows(two, "SELECT count(*) AS n FROM device")).toEqual([
				{ n: 1 },
			]);
		});
	});
}
