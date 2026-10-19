import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";

import { createDb, type Database } from "./index";
import { migrateDb, migrationsFolder } from "./migrate";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

/** A database migrated up to, not including, the migration named `before`. */
async function databaseBefore(before: string): Promise<Database> {
	const root = mkdtempSync(join(tmpdir(), "nightshift-migrate-"));
	roots.push(root);
	const older = join(root, "migrations");
	for (const name of readdirSync(migrationsFolder).sort()) {
		if (name.endsWith(before)) break;
		cpSync(join(migrationsFolder, name), join(older, name), {
			recursive: true,
		});
	}
	const db = createDb({ DATABASE_URL: `file:${join(root, "nightshift.db")}` });
	await migrateDb(db, { migrationsFolder: older });
	return db;
}

const rows = <T>(db: Database, query: string) =>
	db.all<T>(sql.raw(query)) as Promise<T[]>;

describe("migration devices_clones_walkers", () => {
	test("carries projects, runs, steps and events forward onto this computer", async () => {
		const db = await databaseBefore("devices_clones_walkers");
		for (const statement of [
			"INSERT INTO project (id, name, repo_path) VALUES ('p1', 'repo', '/work/repo')",
			"INSERT INTO project (id, name, repo_path, removed_at) VALUES ('p2', 'old', '/work/old', 1)",
			"INSERT INTO run (id, project_id, flow, title, worktree_path, branch, base_ref) VALUES ('r1', 'p1', '{}', 'Run', '/work/repo.nightshift/r1', 'nightshift/r1', 'main')",
			"INSERT INTO step (id, run_id, node_id, node_type, visit, transcript_path) VALUES ('s1', 'r1', 'build', 'agent', 1, '/t/s1.ndjson')",
			"INSERT INTO event (type, payload) VALUES ('ProjectAdded', '{}')",
			"INSERT INTO event (run_id, type) VALUES ('r1', 'RunStarted')",
			"INSERT INTO event (run_id, step_id, type) VALUES ('r1', 's1', 'StepStarted')",
		]) {
			await db.run(sql.raw(statement));
		}

		await migrateDb(db);

		const devices = await rows<{
			id: string;
			name: string;
			platform: string;
			self: number;
		}>(db, "SELECT id, name, platform, self FROM device");
		expect(devices).toHaveLength(1);
		const self = devices[0] as (typeof devices)[number];
		expect(self.self).toBe(1);
		expect(self.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);

		expect(
			await rows(
				db,
				"SELECT id, name, remote, removed_at FROM project ORDER BY id",
			),
		).toEqual([
			{ id: "p1", name: "repo", remote: null, removed_at: null },
			{ id: "p2", name: "old", remote: null, removed_at: 1 },
		]);
		expect(
			await rows(
				db,
				"SELECT project_id, device_id, path FROM clone ORDER BY project_id",
			),
		).toEqual([
			{ project_id: "p1", device_id: self.id, path: "/work/repo" },
			{ project_id: "p2", device_id: self.id, path: "/work/old" },
		]);
		expect(await rows(db, "SELECT id, walker_id FROM run")).toEqual([
			{ id: "r1", walker_id: self.id },
		]);
		expect(await rows(db, "SELECT id, device_id FROM step")).toEqual([
			{ id: "s1", device_id: self.id },
		]);
		expect(
			await rows(
				db,
				"SELECT seq, run_id, type, walker_id, walker_seq FROM event ORDER BY seq",
			),
		).toEqual([
			{
				seq: 1,
				run_id: null,
				type: "ProjectAdded",
				walker_id: self.id,
				walker_seq: 1,
			},
			{
				seq: 2,
				run_id: "r1",
				type: "RunStarted",
				walker_id: self.id,
				walker_seq: 2,
			},
			{
				seq: 3,
				run_id: "r1",
				type: "StepStarted",
				walker_id: self.id,
				walker_seq: 3,
			},
		]);
		expect(await rows(db, "PRAGMA foreign_key_check")).toEqual([]);

		// The local seq continues where it was.
		await db.run(
			sql.raw(
				`INSERT INTO event (type, walker_id, walker_seq) VALUES ('ProjectRemoved', '${self.id}', 4)`,
			),
		);
		expect(
			await rows(db, "SELECT seq FROM event WHERE type = 'ProjectRemoved'"),
		).toEqual([{ seq: 4 }]);
	});

	test("a new database gets its own Device row", async () => {
		const root = mkdtempSync(join(tmpdir(), "nightshift-migrate-"));
		roots.push(root);
		const db = createDb({ DATABASE_URL: `file:${join(root, "fresh.db")}` });
		await migrateDb(db);
		expect(
			await rows(db, "SELECT count(*) AS n FROM device WHERE self = 1"),
		).toEqual([{ n: 1 }]);
	});
});
