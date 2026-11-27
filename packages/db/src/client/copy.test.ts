import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseInstant } from "@nightshift/time";
import { sql } from "drizzle-orm";

import { createDb, type Database } from "./client";
import { copyDatabase } from "./copy";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function folder(): string {
	const root = mkdtempSync(join(tmpdir(), "nightshift-copy-"));
	roots.push(root);
	return root;
}

const AT = parseInstant("2026-11-27T12:00:00.000Z");
const NAME = "before-test-2026-11-27T12-00-00-000Z.db";

async function withRow(): Promise<Database> {
	const db = createDb({ DATABASE_URL: `file:${join(folder(), "n.db")}` });
	await db.run(sql.raw("CREATE TABLE t (v text)"));
	await db.run(sql.raw("INSERT INTO t VALUES ('kept')"));
	return db;
}

describe("copyDatabase", () => {
	test("copies the whole database to a file that names the moment", async () => {
		const db = await withRow();
		const backups = join(folder(), "backups");
		const path = await copyDatabase(db, backups, "test", AT);
		expect(path).toBe(join(backups, NAME));
		const copy = createDb(
			{ DATABASE_URL: `file:${path}` },
			{ singleFile: true },
		);
		expect(await copy.all(sql.raw("SELECT v FROM t"))).toEqual([{ v: "kept" }]);
		copy.$client.close();
	});

	test("refuses a database that is not on this computer before it writes", async () => {
		const db = createDb({ DATABASE_URL: "http://127.0.0.1:9" });
		const backups = join(folder(), "backups");
		await expect(copyDatabase(db, backups, "test", AT)).rejects.toThrow(
			"Night Shift can copy only a database on this computer",
		);
		expect(existsSync(backups)).toBe(false);
	});

	test("a copy that fails leaves no part of itself", async () => {
		const db = await withRow();
		const backups = join(folder(), "backups");
		// The disk fills up halfway: part of the file is there, and the statement fails.
		const failing = new Proxy(db, {
			get(target, key, receiver) {
				if (key !== "run") return Reflect.get(target, key, receiver);
				return async () => {
					writeFileSync(join(backups, NAME), "part");
					throw new Error("database or disk is full");
				};
			},
		});
		await expect(copyDatabase(failing, backups, "test", AT)).rejects.toThrow(
			"database or disk is full",
		);
		expect(readdirSync(backups)).toEqual([]);
	});

	test("never writes over a copy that is there", async () => {
		const db = await withRow();
		const backups = join(folder(), "backups");
		await copyDatabase(db, backups, "test", AT);
		await expect(copyDatabase(db, backups, "test", AT)).rejects.toThrow(
			"is there already",
		);
		expect(readdirSync(backups)).toEqual([NAME]);
	});
});
