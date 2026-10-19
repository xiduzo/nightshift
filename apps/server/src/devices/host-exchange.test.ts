import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DeviceKeyAccess } from "@nightshift/auth/device-keys";
import { member, user } from "@nightshift/db/schema/auth";
import {
	event,
	run as runTable,
	step as stepTable,
} from "@nightshift/db/schema/nightshift";
import { createEngine, type DeviceRegistry } from "@nightshift/engine";
import { createRunLog } from "@nightshift/engine/run-log";
import {
	createSandbox,
	type Sandbox,
	waitFor,
	withDevice,
} from "@nightshift/engine/test-support";
import type { Engine } from "@nightshift/engine/types";

import { createHostExchange } from "./host-exchange";

/**
 * The Host's privacy rule, in one process: a Walker's paths reach the
 * Replicas of its own owner's Devices, never another Person's, whether the
 * Host serves the rows or takes them.
 */

let sandbox: Sandbox;
let engine: Engine;
let ownerId: string;
let projectId: string;
beforeEach(async () => {
	sandbox = await createSandbox();
	engine = createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: {},
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
		}),
		{ runLog: createRunLog(sandbox.db) },
	);
	const [owner] = await sandbox.db.select().from(user);
	ownerId = owner?.id as string;
	// A colleague, Member of the owner's Space.
	await sandbox.db
		.insert(user)
		.values({ id: "colleague", name: "Colleague", email: "c@example.invalid" });
	await sandbox.db.insert(member).values({
		id: "m-colleague",
		organizationId: sandbox.spaceId,
		userId: "colleague",
		role: "member",
		createdAt: new Date(),
	});
	projectId = (
		await engine
			.space(sandbox.spaceId)
			.addProject({ repoPath: sandbox.repoPath })
	).id;
});
afterEach(() => sandbox.cleanup());

/** Devices paired here: one of the owner's, one of the colleague's. */
const registry = {
	async get(id: string) {
		const owners: Record<string, string> = {
			"device-mine": ownerId,
			"device-colleague": "colleague",
		};
		return owners[id] ? { id, ownerId: owners[id], revokedAt: null } : null;
	},
} as unknown as DeviceRegistry;

const keyOf = (deviceId: string, personId: string): DeviceKeyAccess => ({
	keyId: `key-${deviceId}`,
	deviceId,
	personId,
	permissions: { sync: ["pull", "push"], archive: ["put", "get"] },
});

function host() {
	return createHostExchange({
		db: sandbox.db,
		engine,
		registry,
		selfId: sandbox.deviceId,
		ownerId,
		isHost: () => true,
	});
}

const commandFlow = {
	version: 4,
	inputs: [],
	outputs: [],
	start: "hello",
	nodes: [
		{
			id: "hello",
			type: "command",
			position: { x: 0, y: 0 },
			command: "echo hello",
			output: "text",
		},
	],
	edges: [],
} as never;

describe("a Walker's paths", () => {
	test("are served to its owner's Devices only", async () => {
		const started = await engine
			.space(sandbox.spaceId)
			.startRun({ projectId, flow: commandFlow });
		await waitFor(
			async () =>
				(await engine.space(sandbox.spaceId).getRun(started.id)).status ===
				"finished",
		);
		const mine = await host().pull(keyOf("device-mine", ownerId), {});
		const theirs = await host().pull(
			keyOf("device-colleague", "colleague"),
			{},
		);
		const payload = (rows: typeof mine.rows, type: string) =>
			JSON.parse(rows.events.find((e) => e.type === type)?.payload ?? "{}");

		expect(mine.rows.runs[0]?.worktreePath).toContain(sandbox.root);
		expect(payload(mine.rows, "StepStarted").transcriptPath).toContain(
			sandbox.dataDir,
		);

		expect(theirs.rows.runs[0]?.worktreePath).toBe("");
		expect(theirs.rows.steps[0]?.transcriptPath).toBe("");
		expect(payload(theirs.rows, "WorktreeCreated").worktreePath).toBe("");
		expect(payload(theirs.rows, "StepStarted")).toMatchObject({
			transcriptPath: "",
			logPath: "",
		});
		expect(JSON.stringify(theirs.rows)).not.toContain(sandbox.root);
	});

	test("of another Person's Device never land in the Host's Replica", async () => {
		const now = Date.now();
		const rows = {
			runs: [
				{
					id: "run-colleague",
					spaceId: sandbox.spaceId,
					projectId,
					flowName: null,
					flow: "{}",
					bodyFlows: "{}",
					title: "Theirs",
					worktreePath: "/home/colleague/app-wt",
					branch: "nightshift/theirs",
					baseRef: "main",
					walkerId: "device-colleague",
					startedBy: "colleague",
					createdAt: now,
				},
			],
			steps: [
				{
					id: "step-colleague",
					spaceId: sandbox.spaceId,
					runId: "run-colleague",
					nodeId: "hello",
					nodeType: "command",
					visit: 1,
					transcriptPath: "/home/colleague/.nightshift/t.ndjson",
					deviceId: "device-colleague",
					createdAt: now,
				},
			],
			sessions: [],
			events: [
				{
					spaceId: sandbox.spaceId,
					runId: "run-colleague",
					stepId: null,
					sessionId: null,
					type: "WorktreeCreated",
					payload: JSON.stringify({
						worktreePath: "/home/colleague/app-wt",
						branch: "nightshift/theirs",
						baseRef: "main",
					}),
					at: now,
					walkerId: "device-colleague",
					walkerSeq: 1,
				},
				{
					spaceId: sandbox.spaceId,
					runId: "run-colleague",
					stepId: "step-colleague",
					sessionId: null,
					type: "StepStarted",
					payload: JSON.stringify({
						nodeId: "hello",
						nodeType: "command",
						visit: 1,
						transcriptPath: "/home/colleague/.nightshift/t.ndjson",
						logPath: "/home/colleague/.nightshift/t.log",
					}),
					at: now,
					walkerId: "device-colleague",
					walkerSeq: 2,
				},
			],
		};
		await host().push(keyOf("device-colleague", "colleague"), rows);
		const kept = JSON.stringify({
			runs: await sandbox.db.select().from(runTable),
			steps: await sandbox.db.select().from(stepTable),
			events: await sandbox.db.select().from(event),
		});
		expect(kept).toContain("run-colleague");
		expect(kept).toContain("nightshift/theirs");
		expect(kept).not.toContain("/home/colleague");
	});
});
