import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processDatabase } from "./database";
import { hot } from "./hot";

/**
 * `bun --hot` makes the daemon again on each reload, in the same process.
 * Two daemons made in one process share the database client the first
 * one opened, so a reload leaves no client behind.
 */

let dir: string | null = null;
afterEach(async () => {
	if (!dir) return;
	for (const url of hot.nightshiftDatabases?.keys() ?? []) {
		if (url.includes(dir)) hot.nightshiftDatabases?.delete(url);
	}
	await rm(dir, { recursive: true, force: true });
	dir = null;
});

describe("the database client of a process", () => {
	test("is the one the first daemon opened, at every reload", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-db-"));
		const url = `file:${join(dir, "nightshift.db")}`;
		const first = processDatabase(url);
		const reloaded = processDatabase(url);
		expect(reloaded).toBe(first);
		// It still answers: nothing closed it.
		expect(await reloaded.$client.execute("select 1 as one")).toMatchObject({
			rows: [{ one: 1 }],
		});
	});

	test("is its own for another database", async () => {
		dir = await mkdtemp(join(tmpdir(), "nightshift-db-"));
		const one = processDatabase(`file:${join(dir, "one.db")}`);
		const other = processDatabase(`file:${join(dir, "other.db")}`);
		expect(other).not.toBe(one);
	});
});
