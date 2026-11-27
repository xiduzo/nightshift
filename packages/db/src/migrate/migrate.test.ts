import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
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

const rows = <T extends Record<string, unknown>>(db: Database, query: string) =>
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

describe("migration project_folder", () => {
	test("every project from before has a folder", async () => {
		const db = await databaseBefore("project_folder");
		await db.run(
			sql.raw(
				"INSERT INTO project (id, space_id, name, remote) VALUES ('p1', 's', 'app', 'github.com/acme/app')",
			),
		);
		await migrateDb(db);
		expect(await rows(db, "SELECT id, folder FROM project")).toEqual([
			{ id: "p1", folder: 1 },
		]);
	});
});

describe("migration answer_cost_shared", () => {
	test("each answer kept before gets a key of its own, as this computer's", async () => {
		const db = await databaseBefore("answer_cost_shared");
		for (const at of [1, 2]) {
			await db.run(
				sql.raw(
					`INSERT INTO answer_cost (space_id, person_id, agent, input_tokens, output_tokens, at) VALUES ('s', 'p', 'explainer', 1, 1, ${at})`,
				),
			);
		}
		await migrateDb(db);
		const kept = await rows<{
			key: string;
			device_id: string | null;
			host_seq: number | null;
			sent_at: number | null;
		}>(db, "SELECT key, device_id, host_seq, sent_at FROM answer_cost");
		expect(kept.map((row) => row.key.length)).toEqual([32, 32]);
		expect(new Set(kept.map((row) => row.key)).size).toBe(2);
		expect(kept.map(({ key: _, ...rest }) => rest)).toEqual([
			{ device_id: null, host_seq: null, sent_at: null },
			{ device_id: null, host_seq: null, sent_at: null },
		]);
	});
});

describe("migration membership_repair", () => {
	test("an existing merge and split keep every value, and the build before it goes on with the database", async () => {
		const db = await databaseBefore("membership_repair");
		const merge =
			"INSERT INTO space_merge (from_space, host_id, person_id, state, backup, project_map) VALUES";
		const split =
			"INSERT INTO space_split (to_space, from_space, host_id, host_name, person_id, host_person_id, state, backup, unpinned) VALUES";
		await db.run(sql.raw(`${merge} ('a', 'h', 'p', 'moved', '/b', '{}')`));
		await db.run(
			sql.raw(`${split} ('t', 'f', 'h', 'H', 'p', 'q', 'planned', '/b', 2)`),
		);
		const old = async () => ({
			merges: await rows(
				db,
				"SELECT from_space, host_id, person_id, state, to_space, project_map, person_map, joined, backup, created_at, updated_at FROM space_merge",
			),
			splits: await rows(
				db,
				"SELECT to_space, from_space, host_id, host_name, person_id, host_person_id, state, projects, runs, unpinned, backup, created_at, updated_at FROM space_split",
			),
		});
		const before = await old();

		await migrateDb(db);

		expect(await old()).toEqual(before);
		expect(
			await rows(
				db,
				"SELECT late, paused, waiting FROM space_merge, space_split",
			),
		).toEqual([{ late: null, paused: null, waiting: null }]);

		// The build before it: its migrations, its reads and its writes.
		const older = mkdtempSync(join(tmpdir(), "nightshift-migrate-"));
		roots.push(older);
		for (const name of readdirSync(migrationsFolder).sort()) {
			if (name.endsWith("membership_repair")) break;
			cpSync(join(migrationsFolder, name), join(older, name), {
				recursive: true,
			});
		}
		await db.run(
			sql.raw(
				`UPDATE space_merge SET late = '{"projectMap":{},"personMap":{}}'`,
			),
		);
		await migrateDb(db, { migrationsFolder: older });
		expect(await old()).toEqual(before);
		await db.run(sql.raw(`${merge} ('b', 'h', 'p', 'planned', '/b', '{}')`));
		await db.run(
			sql.raw(`${split} ('u', 'f', 'h', 'H', 'p', 'q', 'done', '/b', 0)`),
		);
		await db.run(sql.raw("UPDATE space_merge SET state = 'pushed'"));
		expect((await old()).merges).toHaveLength(2);
		// And this build again.
		await migrateDb(db);
		expect((await old()).splits).toHaveLength(2);
	});
});

describe("migration host_space_left", () => {
	const seed = [
		// Made here: never a Host's.
		"INSERT INTO organization (id, name, slug, created_at) VALUES ('own', 'Own', 'own-1a2b3c4d', 1)",
		// A Host keeps it: its row stays as it is.
		"INSERT INTO organization (id, name, slug, created_at) VALUES ('kept', 'Kept', 'host-kept', 1)",
		"INSERT INTO host_space (space_id, host_id, name, role, personal, updated_at) VALUES ('kept', 'host-a', 'Kept there', 'member', 0, 5)",
		// Left, and one Host exchanged its runs.
		"INSERT INTO organization (id, name, slug, created_at) VALUES ('left-a', 'Left A', 'host-left-a', 1)",
		"INSERT INTO sync_cursor (host_id, space_id, walker_id, walker_seq) VALUES ('host-a', 'left-a', 'w1', 3)",
		"INSERT INTO sync_cursor (host_id, space_id, walker_id, walker_seq) VALUES ('host-a', 'left-a', 'w2', 4)",
		// Left, and two Hosts exchanged its runs: the Host is not known.
		"INSERT INTO organization (id, name, slug, created_at) VALUES ('left-two', 'Left two', 'host-left-two', 1)",
		"INSERT INTO sync_cursor (host_id, space_id, walker_id, walker_seq) VALUES ('host-a', 'left-two', 'w1', 1)",
		"INSERT INTO sync_cursor (host_id, space_id, walker_id, walker_seq) VALUES ('host-b', 'left-two', 'w1', 1)",
		// Left, and no Host exchanged its runs.
		"INSERT INTO organization (id, name, slug, created_at) VALUES ('left-none', 'Left none', 'host-left-none', 1)",
	];
	const kept = (db: Database) =>
		rows<{
			space_id: string;
			host_id: string;
			name: string;
			role: string;
			personal: number;
			left: number;
		}>(
			db,
			"SELECT space_id, host_id, name, role, personal, left_at IS NOT NULL AS left FROM host_space ORDER BY space_id",
		);

	test("adds a left row for each Space a Host listed before, with its Host when one is known", async () => {
		const db = await databaseBefore("host_space_left");
		for (const statement of seed) await db.run(sql.raw(statement));
		const info = spyOn(console, "info").mockImplementation(() => {});
		const spaces = () => rows(db, "SELECT * FROM organization ORDER BY id");
		const spacesBefore = await spaces();

		await migrateDb(db);

		expect(await kept(db)).toEqual([
			{
				space_id: "kept",
				host_id: "host-a",
				name: "Kept there",
				role: "member",
				personal: 0,
				left: 0,
			},
			{
				space_id: "left-a",
				host_id: "host-a",
				name: "Left A",
				role: "",
				personal: 0,
				left: 1,
			},
			{
				space_id: "left-none",
				host_id: "",
				name: "Left none",
				role: "",
				personal: 0,
				left: 1,
			},
			{
				space_id: "left-two",
				host_id: "",
				name: "Left two",
				role: "",
				personal: 0,
				left: 1,
			},
		]);
		expect(info).toHaveBeenCalledWith(
			"Migration 20261126093041_host_space_left: added 3 rows for Spaces this computer left (2 with no known Host).",
		);
		// Every organization row stays.
		expect(await spaces()).toEqual(spacesBefore);

		// Again: it adds nothing and changes nothing.
		info.mockClear();
		const again = readFileSync(
			join(migrationsFolder, "20261126093041_host_space_left", "migration.sql"),
			"utf8",
		).split("--> statement-breakpoint")[1] as string;
		const before = await kept(db);
		await db.run(sql.raw(again));
		await migrateDb(db);
		expect(await kept(db)).toEqual(before);
		expect(info).not.toHaveBeenCalled();
		info.mockRestore();
	});

	test("adds nothing to a database without such Spaces", async () => {
		const db = await databaseBefore("host_space_left");
		const info = spyOn(console, "info").mockImplementation(() => {});
		await migrateDb(db);
		expect(await kept(db)).toEqual([]);
		expect(info).not.toHaveBeenCalled();
		info.mockRestore();
	});
});

describe("migration run_end_codes", () => {
	/**
	 * Run ends as the engine logged them before `endReason` existed, and the
	 * code each one gets: the words of its sentence. A run that finished is
	 * `finished`, whatever its message says.
	 */
	const OLD_ENDS: [string, string | null, string | null, string][] = [
		["finished", null, null, "finished"],
		["finished", "Usage limit: 5 users", null, "finished"],
		["finished", "The server showed no activity", "done", "finished"],
		["finished", "The check failed.", "failed", "_OTHER"],
		[
			"stopped",
			"Usage limit: You've hit your limit. It resets after the stop time, so the run stopped. Resume the run to continue.",
			null,
			"agent.usage_limit",
		],
		[
			"stopped",
			"The network is down: offline. The next try is after the stop time, so the run stopped. Resume the run to continue.",
			null,
			"agent.network",
		],
		[
			"failed",
			'Node "w" failed: The network was down for more than 5 min: offline',
			null,
			"agent.network",
		],
		["stopped", "Reached the stop time", null, "stop_time"],
		[
			"failed",
			"The run spent $3.00 of its $1.00 budget, so it stopped. Resume it to spend up to $1.00 more.",
			null,
			"guard.budget",
		],
		[
			"failed",
			'Node "w" failed: The agent reached its limit of 4 turns, so the step stopped.',
			null,
			"guard.turns",
		],
		[
			"failed",
			'Node "w" failed: The agent called Read 3 times in a row with the same input, so the step stopped.',
			null,
			"guard.looping",
		],
		[
			"failed",
			'Node "w" failed: The agent showed no activity for 1 min, so the step stopped.',
			null,
			"guard.idle",
		],
		[
			"failed",
			'The run reached the limit of 10 steps before node "w". Resume it to continue.',
			null,
			"guard.max_steps",
		],
		["stopped", null, null, "stopped_by_person"],
		[
			"stopped",
			"Stopped after the running step, as asked.",
			null,
			"stopped_by_person",
		],
		["failed", null, "failed", "_OTHER"],
		["failed", "Something else.", null, "_OTHER"],
		["interrupted", "Night Shift stopped.", null, "_OTHER"],
	];

	/** Events in the current shape: the migration leaves each one as it is. */
	const CURRENT: [string, string][] = [
		// Its words would give another code: the stored one stays.
		[
			"RunEnded",
			'{"status":"failed","reason":"Usage limit: soon","endReason":"_OTHER"}',
		],
		["RunEnded", '{"status":"finished","reason":null,"endReason":"finished"}'],
		[
			"WorktreeRemoved",
			'{"projectId":"p","runId":"r","worktreePath":null,"branches":["b"]}',
		],
		// Another event's `by` is not a removal's.
		["OfferWithdrawn", '{"deviceId":"d","profile":"p","by":"person-1"}'],
		// Not an object: no code can go in, so it is not counted.
		["RunEnded", "[1]"],
		["RunEnded", '"Reached the stop time"'],
		["WorktreeRemoved", '["by"]'],
		// Not valid JSON: never read, never changed.
		["RunEnded", "{not json"],
	];

	async function seed(db: Database): Promise<void> {
		let seq = 0;
		const add = (type: string, payload: string) =>
			db.run(
				sql`INSERT INTO event (space_id, run_id, type, payload, walker_id, walker_seq) VALUES ('s', 'r', ${type}, ${payload}, 'd', ${++seq})`,
			);
		// Every other one says its code is null: also no code.
		for (const [i, [status, reason, result]] of OLD_ENDS.entries()) {
			await add(
				"RunEnded",
				JSON.stringify({
					status,
					reason,
					...(result ? { result } : {}),
					...(i % 2 ? { endReason: null } : {}),
				}),
			);
		}
		for (const by of ["cleanup", "person"]) {
			await add(
				"WorktreeRemoved",
				JSON.stringify({
					projectId: "p",
					runId: "r",
					worktreePath: "/work/r",
					branches: [],
					by,
				}),
			);
		}
		for (const [type, payload] of CURRENT) await add(type, payload);
	}

	const events = (db: Database) =>
		rows<{ seq: number; type: string; payload: string }>(
			db,
			"SELECT seq, type, payload FROM event ORDER BY seq",
		);

	async function folderOf(db: Database): Promise<string> {
		const [main] = await rows<{ file: string }>(db, "PRAGMA database_list");
		return join(main?.file as string, "..");
	}

	test("gives each old run end its code and takes who removed it out of each removal, after a copy of the database", async () => {
		const db = await databaseBefore("run_end_codes");
		await seed(db);
		const before = await events(db);
		const info = spyOn(console, "info").mockImplementation(() => {});

		await migrateDb(db);

		const after = await events(db);
		const ends = after.slice(0, OLD_ENDS.length);
		expect(ends.map((e) => JSON.parse(e.payload).endReason)).toEqual(
			OLD_ENDS.map(([, , , code]) => code),
		);
		// Only the code is added: every other field stays.
		for (const [i, end] of ends.entries()) {
			const { endReason: _, ...rest } = JSON.parse(end.payload);
			const { endReason: __, ...was } = JSON.parse(
				before[i]?.payload as string,
			);
			expect(rest).toEqual(was);
		}
		const removals = after.slice(OLD_ENDS.length, OLD_ENDS.length + 2);
		expect(removals.map((e) => JSON.parse(e.payload))).toEqual([
			{ projectId: "p", runId: "r", worktreePath: "/work/r", branches: [] },
			{ projectId: "p", runId: "r", worktreePath: "/work/r", branches: [] },
		]);
		// Rows in the current shape stay byte for byte.
		expect(after.slice(OLD_ENDS.length + 2)).toEqual(
			before.slice(OLD_ENDS.length + 2),
		);

		// The copy came first: it holds the events as they were.
		const backups = join(await folderOf(db), "backups");
		const [name, ...more] = readdirSync(backups);
		expect(more).toEqual([]);
		expect(name).toStartWith("before-run-end-codes-");
		const copy = createDb(
			{ DATABASE_URL: `file:${join(backups, name as string)}` },
			{ singleFile: true },
		);
		expect(await events(copy)).toEqual(before);
		copy.$client.close();
		expect(info).toHaveBeenCalledWith(
			`Migration 20261127112537_run_end_codes: gave ${OLD_ENDS.length} run ends their code and took who removed them out of 2 removals of run files. The copy of the database: ${join(backups, name as string)}`,
		);

		// Again: it changes nothing, copies nothing and logs nothing.
		info.mockClear();
		const again = readFileSync(
			join(migrationsFolder, "20261127112537_run_end_codes", "migration.sql"),
			"utf8",
		).split("--> statement-breakpoint");
		for (const statement of again) await db.run(sql.raw(statement));
		await migrateDb(db);
		expect(await events(db)).toEqual(after);
		expect(readdirSync(backups)).toEqual([name as string]);
		expect(info).not.toHaveBeenCalled();
		info.mockRestore();
	});

	test("a database with nothing to change gets no copy and no line", async () => {
		const db = await databaseBefore("run_end_codes");
		for (const [i, [type, payload]] of CURRENT.slice(0, 4).entries()) {
			await db.run(
				sql`INSERT INTO event (space_id, type, payload, walker_id, walker_seq) VALUES ('s', ${type}, ${payload}, 'd', ${i + 1})`,
			);
		}
		const before = await events(db);
		const info = spyOn(console, "info").mockImplementation(() => {});
		await migrateDb(db);
		expect(await events(db)).toEqual(before);
		expect(existsSync(join(await folderOf(db), "backups"))).toBe(false);
		expect(info).not.toHaveBeenCalled();
		info.mockRestore();
	});
});
