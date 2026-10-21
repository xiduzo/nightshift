import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DeviceKeyAccess } from "@nightshift/auth";
import {
	event,
	member,
	run as runTable,
	step as stepTable,
	user,
} from "@nightshift/db/schema";
import {
	createRunLog,
	createSandbox,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/testing";
import { createPeerEngine, type PeerEngine } from "../peers";
import type { DeviceRegistry } from "../registry";
import { withPeers } from "../testing";
import { createWorkHub } from "../work";
import { createHostExchange } from "./host-exchange";

/**
 * The Host's privacy rule, in one process: a Walker's paths reach the
 * Replicas of its own owner's Devices, never another Person's, whether the
 * Host serves the rows or takes them.
 */

let sandbox: Sandbox;
let engine: PeerEngine;
let ownerId: string;
let projectId: string;
beforeEach(async () => {
	sandbox = await createSandbox();
	engine = createPeerEngine(
		withPeers({
			db: sandbox.db,
			harnesses: {},
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
		}),
		{ runLog: createRunLog(sandbox.db, { walkerId: sandbox.deviceId }) },
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
			// Paired here, but its Person is in none of the owner's Spaces.
			"device-stranger": "stranger",
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
		work: createWorkHub(),
	});
}

const commandFlow = {
	version: 5,
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
					deviceId: null,
					placements: null,
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

describe("live transcripts", () => {
	/** A run the colleague's Device walks here, with one running step. */
	async function colleagueRun() {
		const now = Date.now();
		await host().push(keyOf("device-colleague", "colleague"), {
			runs: [
				{
					id: "run-live",
					spaceId: sandbox.spaceId,
					projectId,
					flowName: null,
					flow: "{}",
					bodyFlows: "{}",
					title: "Live",
					worktreePath: "",
					branch: "nightshift/live",
					baseRef: "main",
					walkerId: "device-colleague",
					startedBy: "colleague",
					deviceId: null,
					placements: null,
					createdAt: now,
				},
			],
			steps: [
				{
					id: "step-live",
					spaceId: sandbox.spaceId,
					runId: "run-live",
					nodeId: "hello",
					nodeType: "command",
					visit: 1,
					transcriptPath: "",
					deviceId: "device-colleague",
					createdAt: now,
				},
			],
			sessions: [],
			events: [
				{
					spaceId: sandbox.spaceId,
					runId: "run-live",
					stepId: "step-live",
					sessionId: null,
					type: "StepStarted",
					payload: JSON.stringify({
						nodeId: "hello",
						nodeType: "command",
						visit: 1,
						transcriptPath: "",
						logPath: "",
					}),
					at: now,
					walkerId: "device-colleague",
					walkerSeq: 1,
				},
			],
		});
		return { spaceId: sandbox.spaceId, runId: "run-live", stepId: "step-live" };
	}

	const entry = (seq: number) =>
		({
			seq,
			stepId: "step-live",
			sessionId: null,
			at: Date.now(),
			event: { type: "command-output", stream: "stdout", text: `line ${seq}` },
		}) as never;

	test("a Member follows a step its Walker sends while someone follows it", async () => {
		const step = await colleagueRun();
		const exchange = host();
		const walker = keyOf("device-colleague", "colleague");
		expect((await exchange.pull(walker, {})).follows).toEqual([]);

		const controller = new AbortController();
		const got: number[] = [];
		const following = (async () => {
			for await (const e of exchange.archiveFollow(
				keyOf("device-mine", ownerId),
				{ step, afterSeq: 0 },
				controller.signal,
			)) {
				got.push(e.seq);
			}
		})();
		// The Walker's stream now names the step.
		await waitFor(
			async () => (await exchange.pull(walker, {})).follows.length === 1,
		);
		expect((await exchange.pull(walker, {})).follows).toEqual([
			{ ...step, afterSeq: 0 },
		]);

		// Only the Walker may send its entries.
		await expect(
			exchange.archiveTail(keyOf("device-mine", ownerId), {
				step,
				entries: [entry(1)],
				ended: false,
			}),
		).rejects.toThrow("only archive the runs it walks");

		await exchange.archiveTail(walker, {
			step,
			entries: [entry(1), entry(2)],
			ended: false,
		});
		await waitFor(() => got.length === 2);
		await exchange.archiveTail(walker, {
			step,
			entries: [entry(2), entry(3)],
			ended: true,
		});
		await following;
		expect(got).toEqual([1, 2, 3]);
		expect((await exchange.pull(walker, {})).follows).toEqual([]);
		controller.abort();
	});

	test("a Person who is not a Member of the run's Space is refused", async () => {
		const step = await colleagueRun();
		const follow = async () => {
			for await (const _ of host().archiveFollow(
				keyOf("device-stranger", "stranger"),
				{ step, afterSeq: 0 },
				new AbortController().signal,
			)) {
				// Nothing reaches a stranger.
			}
		};
		await expect(follow()).rejects.toThrow("not a member");
		expect(
			(await host().pull(keyOf("device-colleague", "colleague"), {})).follows,
		).toEqual([]);
	});
});
