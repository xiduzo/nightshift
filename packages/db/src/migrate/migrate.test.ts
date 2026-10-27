import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";

import { createDb, type Database } from "../client";
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
				`INSERT INTO event (space_id, type, walker_id, walker_seq) VALUES ('s', 'ProjectRemoved', '${self.id}', 4)`,
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

describe("migration spaces", () => {
	const personalOf = (db: Database, userId: string) =>
		rows<{ id: string; name: string; personal: number; role: string }>(
			db,
			`SELECT organization.id, organization.name, organization.personal, member.role FROM organization JOIN member ON member.organization_id = organization.id WHERE member.user_id = '${userId}'`,
		);

	test("puts every row in the personal Space of this computer's Person", async () => {
		const db = await databaseBefore("spaces");
		for (const statement of [
			"INSERT INTO user (id, name, email) VALUES ('u1', 'Ada', 'ada@example.com')",
			"INSERT INTO user (id, name, email, created_at) VALUES ('u2', 'Bob', 'bob@example.com', 9999999999999)",
			"INSERT INTO session (id, expires_at, token, updated_at, user_id) VALUES ('se1', 9999999999999, 't1', 1, 'u2')",
			"INSERT INTO project (id, name) VALUES ('p1', 'repo')",
			"INSERT INTO clone (id, project_id, device_id, path) SELECT 'c1', 'p1', id, '/work/repo' FROM device WHERE self = 1",
			"INSERT INTO run (id, project_id, flow, title, worktree_path, branch, base_ref, walker_id) VALUES ('r1', 'p1', '{}', 'Run', '/w', 'b', 'main', 'd')",
			"INSERT INTO step (id, run_id, node_id, node_type, visit, transcript_path) VALUES ('s1', 'r1', 'build', 'agent', 1, '/t/s1.ndjson')",
			"INSERT INTO agent_session (id, run_id, step_id, prompt) VALUES ('a1', 'r1', 's1', 'Go')",
			"INSERT INTO event (type, payload, walker_id, walker_seq) VALUES ('ProjectAdded', '{}', 'd', 1)",
			"INSERT INTO event (run_id, type, walker_id, walker_seq) VALUES ('r1', 'RunStarted', 'd', 2)",
		]) {
			await db.run(sql.raw(statement));
		}

		await migrateDb(db);

		// The earliest account owns this computer.
		expect(
			await rows(db, "SELECT owner_id FROM device WHERE self = 1"),
		).toEqual([{ owner_id: "u1" }]);
		const [ada] = await personalOf(db, "u1");
		expect(ada).toMatchObject({ name: "Personal", personal: 1, role: "owner" });
		const [bob] = await personalOf(db, "u2");
		expect(bob).toMatchObject({ personal: 1, role: "owner" });
		expect(bob?.id).not.toBe(ada?.id);
		expect(
			await rows(db, "SELECT active_organization_id AS space FROM session"),
		).toEqual([{ space: bob?.id }]);

		for (const table of [
			"project",
			"clone",
			"run",
			"step",
			"agent_session",
			"event",
		]) {
			expect(
				await rows(db, `SELECT DISTINCT space_id AS space FROM ${table}`),
			).toEqual([{ space: ada?.id }]);
		}
		expect(await rows(db, "SELECT count(*) AS n FROM event")).toEqual([
			{ n: 2 },
		]);
		expect(await rows(db, "PRAGMA foreign_key_check")).toEqual([]);
	});

	test("a database without an account gets the Person of this computer", async () => {
		const root = mkdtempSync(join(tmpdir(), "nightshift-migrate-"));
		roots.push(root);
		const db = createDb({ DATABASE_URL: `file:${join(root, "fresh.db")}` });
		await migrateDb(db);
		const [owner] = await rows<{ id: string; email: string }>(
			db,
			"SELECT user.id, user.email FROM user JOIN device ON device.owner_id = user.id WHERE device.self = 1",
		);
		expect(owner?.email).toBe("local@nightshift.invalid");
		expect(await personalOf(db, owner?.id ?? "")).toHaveLength(1);
	});
});

describe("migration members", () => {
	test("makes this computer's Person the Host admin and the starter of its runs", async () => {
		const db = await databaseBefore("members");
		for (const statement of [
			"INSERT INTO user (id, name, email, created_at) VALUES ('u2', 'Bob', 'bob@example.com', 9999999999999)",
			"INSERT INTO project (id, space_id, name) VALUES ('p1', 's', 'repo')",
			"INSERT INTO run (id, space_id, project_id, flow, title, worktree_path, branch, base_ref, walker_id) VALUES ('r1', 's', 'p1', '{}', 'Run', '/w', 'b', 'main', 'd')",
			"INSERT INTO run (id, space_id, project_id, flow, title, worktree_path, branch, base_ref, walker_id) VALUES ('r2', 's', 'p1', '{}', 'Nightly', '/w2', 'b2', 'main', 'd')",
			`INSERT INTO event (run_id, space_id, type, payload, walker_id, walker_seq) VALUES ('r2', 's', 'RunStarted', '{"trigger":{"kind":"schedule","scheduleId":"n","at":1}}', 'd', 1)`,
		]) {
			await db.run(sql.raw(statement));
		}

		await migrateDb(db);

		const [owner] = await rows<{ id: string }>(
			db,
			"SELECT owner_id AS id FROM device WHERE self = 1",
		);
		expect(
			await rows(db, "SELECT id, role FROM user ORDER BY created_at"),
		).toEqual([
			{ id: owner?.id, role: "admin" },
			{ id: "u2", role: "user" },
		]);
		expect(
			await rows(db, "SELECT id, started_by FROM run ORDER BY id"),
		).toEqual([
			{ id: "r1", started_by: owner?.id },
			{ id: "r2", started_by: null },
		]);
	});
});

describe("migration run_starters", () => {
	test("gives the runs this computer walks without a starter its Person, as the Host of their Space knows them", async () => {
		const db = await databaseBefore("run_starters");
		const [self] = await rows<{ id: string; ownerId: string }>(
			db,
			"SELECT id, owner_id AS ownerId FROM device WHERE self = 1",
		);
		const run = (id: string, space: string, walker: string, by: string) =>
			`INSERT INTO run (id, space_id, project_id, flow, title, worktree_path, branch, base_ref, walker_id, started_by) VALUES ('${id}', '${space}', 'p1', '{}', 'Run', '/w/${id}', 'b-${id}', 'main', '${walker}', ${by})`;
		for (const statement of [
			"INSERT INTO project (id, space_id, name) VALUES ('p1', 's', 'repo')",
			"INSERT INTO host_link (host_id, name, addresses, role, person_id, key_store) VALUES ('h1', 'studio', '[]', 'home', 'person-on-host', 'file')",
			"INSERT INTO host_space (space_id, host_id, name, role) VALUES ('team', 'h1', 'Team', 'member')",
			run("scheduled", "s", self?.id ?? "", "NULL"),
			run("in-team", "team", self?.id ?? "", "NULL"),
			run("elsewhere", "s", "another-device", "NULL"),
			run("started", "s", self?.id ?? "", "'u2'"),
		]) {
			await db.run(sql.raw(statement));
		}

		await migrateDb(db);

		expect(
			await rows(db, "SELECT id, started_by FROM run ORDER BY id"),
		).toEqual([
			{ id: "elsewhere", started_by: null },
			{ id: "in-team", started_by: "person-on-host" },
			{ id: "scheduled", started_by: self?.ownerId },
			{ id: "started", started_by: "u2" },
		]);
	});
});

describe("migration run_device_names", () => {
	test("gives each run the names of its Devices this computer knows: its own and the ones its nodes name", async () => {
		const db = await databaseBefore("run_device_names");
		const [self] = await rows<{ id: string; name: string }>(
			db,
			"SELECT id, name FROM device WHERE self = 1",
		);
		const run = (id: string, device: string, placements: string) =>
			`INSERT INTO run (id, space_id, project_id, flow, title, worktree_path, branch, base_ref, walker_id, device_id, placements) VALUES ('${id}', 's', 'p1', '{}', 'Run', '/w/${id}', 'b-${id}', 'main', '${self?.id}', ${device}, ${placements})`;
		for (const statement of [
			"INSERT INTO project (id, space_id, name) VALUES ('p1', 's', 'repo')",
			"INSERT INTO device (id, name, platform) VALUES ('d-b', 'studio-b', 'linux')",
			"INSERT INTO device (id, name, platform) VALUES ('d-c', 'hetzner-1', 'linux')",
			run("before-placement", "NULL", "NULL"),
			run("on-b", "'d-b'", "NULL"),
			run("named", "'d-b'", `'{"hetzner-1":"d-c","gone":"d-x"}'`),
			run("unknown", "'d-x'", "'not json'"),
		]) {
			await db.run(sql.raw(statement));
		}

		await migrateDb(db);

		const named = await rows<{ id: string; device_names: string }>(
			db,
			"SELECT id, device_names FROM run ORDER BY id",
		);
		expect(
			named.map((r) => [r.id, JSON.parse(r.device_names) as unknown]),
		).toEqual([
			["before-placement", { [self?.id ?? ""]: self?.name }],
			["named", { "d-b": "studio-b", "d-c": "hetzner-1" }],
			["on-b", { "d-b": "studio-b" }],
			["unknown", {}],
		]);
	});
});

describe("migration run_flow_revisions", () => {
	test("a run from before Flow revisions has none", async () => {
		const db = await databaseBefore("run_flow_revisions");
		for (const statement of [
			"INSERT INTO project (id, space_id, name) VALUES ('p1', 's', 'repo')",
			"INSERT INTO run (id, space_id, project_id, flow, title, worktree_path, branch, base_ref, walker_id) VALUES ('r1', 's', 'p1', '{}', 'Run', '/w/r1', 'b-r1', 'main', 'd1')",
		]) {
			await db.run(sql.raw(statement));
		}
		await migrateDb(db);
		expect(
			await rows(db, "SELECT flow_revision, body_flow_revisions FROM run"),
		).toEqual([{ flow_revision: null, body_flow_revisions: "{}" }]);
	});
});
