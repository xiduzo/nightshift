import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";

import { createDb, type Database } from "./client";

const roots: string[] = [];
const opened: Database[] = [];

afterEach(() => {
	for (const db of opened.splice(0)) db.$client.close();
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function fileDb(options?: { singleFile?: boolean }): Database {
	const root = mkdtempSync(join(tmpdir(), "nightshift-client-"));
	roots.push(root);
	const db = createDb(
		{ DATABASE_URL: `file:${join(root, "nightshift.db")}` },
		options,
	);
	opened.push(db);
	return db;
}

async function pragma(db: Database, name: string): Promise<unknown> {
	const [row] = await db.all<Record<string, unknown>>(
		sql.raw(`PRAGMA ${name}`),
	);
	return Object.values(row ?? {})[0];
}

describe("createDb", () => {
	test("a database file writes ahead to a log, synced at checkpoints, and waits for locks", async () => {
		const db = fileDb();
		expect(await pragma(db, "journal_mode")).toBe("wal");
		// 1 is NORMAL.
		expect(await pragma(db, "synchronous")).toBe(1);
		expect(await pragma(db, "busy_timeout")).toBe(5000);
	});

	test("the settings hold for every statement of the client, also concurrent ones", async () => {
		const db = fileDb();
		await db.run(sql`create table t (id integer primary key)`);
		const settings = await Promise.all([
			pragma(db, "synchronous"),
			db.run(sql`insert into t default values`),
			pragma(db, "synchronous"),
		]);
		expect([settings[0], settings[2]]).toEqual([1, 1]);
	});

	test("a file that must stay one file keeps the rollback journal", async () => {
		const db = fileDb({ singleFile: true });
		expect(await pragma(db, "journal_mode")).toBe("delete");
	});

	test("an in-memory database keeps the defaults", async () => {
		const db = createDb({ DATABASE_URL: ":memory:" });
		opened.push(db);
		expect(await pragma(db, "journal_mode")).toBe("memory");
		await db.run(sql`create table t (id integer primary key)`);
		await db.run(sql`insert into t default values`);
		expect(await db.all(sql`select id from t`)).toEqual([{ id: 1 }]);
	});
});
