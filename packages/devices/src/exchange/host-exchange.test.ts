import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { DeviceKeyAccess } from "@nightshift/auth";
import {
	event,
	member,
	organization,
	project as projectTable,
	run as runTable,
	step as stepTable,
	user,
} from "@nightshift/db/schema";
import { createSpaceDocuments, type SpaceDocuments } from "@nightshift/engine";
import {
	createRunLog,
	createSandbox,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/testing";
import { ORPCError } from "@orpc/server";
import type { SyncBatch } from "../contract";
import { createPeerEngine, deviceDirectory, type PeerEngine } from "../peers";
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
let runLog: ReturnType<typeof createRunLog>;
let engine: PeerEngine;
let documents: SpaceDocuments;
let ownerId: string;
let projectId: string;
beforeEach(async () => {
	sandbox = await createSandbox();
	runLog = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
	documents = createSpaceDocuments({
		db: sandbox.db,
		directory: deviceDirectory(sandbox.db),
	});
	engine = createPeerEngine(
		withPeers({
			db: sandbox.db,
			harnesses: {},
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
			spaceDocuments: documents,
		}),
		{ runLog },
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
		documents,
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
					deviceNames: null,
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
					deviceNames: null,
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

	/** The colleague's Device logs a step event of the live run, as its `walkerSeq`th. */
	async function logged(type: "StepEnded" | "StepReopened", walkerSeq: number) {
		await host().push(keyOf("device-colleague", "colleague"), {
			runs: [],
			steps: [],
			sessions: [],
			events: [
				{
					spaceId: sandbox.spaceId,
					runId: "run-live",
					stepId: "step-live",
					sessionId: null,
					type,
					payload: JSON.stringify(
						type === "StepEnded"
							? { outcome: "pass", outputs: { visit: 1 }, error: null }
							: { prompt: null },
					),
					at: Date.now(),
					walkerId: "device-colleague",
					walkerSeq,
				},
			],
		});
	}

	test("the Host serves a step's copy only of the end its log knows, and an older Walker's copy as before", async () => {
		const step = await colleagueRun();
		const exchange = host();
		const walker = keyOf("device-colleague", "colleague");
		const reader = keyOf("device-mine", ownerId);
		const ref = { kind: "transcript" as const, ...step };

		await logged("StepEnded", 2);
		await exchange.archivePut(walker, ref, "first end", {
			opening: 1,
			ended: true,
		});
		expect(await exchange.archiveGet(reader, ref)).toBe("first end");

		// Reopened and ended again: its rows are here, its copy not yet.
		await logged("StepReopened", 3);
		await logged("StepEnded", 4);
		expect(await exchange.archiveGet(reader, ref)).toBeNull();
		await exchange.archivePut(walker, ref, "second end", {
			opening: 2,
			ended: true,
		});
		expect(await exchange.archiveGet(reader, ref)).toBe("second end");

		// A Walker of an older version puts no stamp: its copy is served.
		await exchange.archivePut(walker, ref, "unstamped");
		expect(await exchange.archiveGet(reader, ref)).toBe("unstamped");
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

describe("the Commands that wait for a Device", () => {
	test("come on their own stream, again each time they change; an older Device gets them with the rows", async () => {
		const key = keyOf("device-mine", ownerId);
		const kept = await engine.exchange.commands.enqueue({
			kind: "signal.send",
			payload: { name: "go" },
			spaceId: sandbox.spaceId,
			runId: "run-1",
			walkerId: "device-mine",
			personId: ownerId,
		});
		const stop = new AbortController();
		try {
			const commands = host()
				.commands(key, stop.signal)
				[Symbol.asyncIterator]();
			expect((await commands.next()).value).toEqual({ commands: [kept] });
			const next = commands.next();
			await engine.exchange.commands.done(kept.id, "device-mine", null);
			expect((await next).value).toEqual({ commands: [] });

			// An older Device asks for rows only, without the option.
			const again = await engine.exchange.commands.enqueue({
				kind: "signal.send",
				payload: { name: "go" },
				spaceId: sandbox.spaceId,
				runId: "run-1",
				walkerId: "device-mine",
				personId: ownerId,
			});
			const rows = host()
				.stream(key, { cursors: {} }, stop.signal)
				[Symbol.asyncIterator]();
			expect((await rows.next()).value?.commands).toEqual([again]);
		} finally {
			stop.abort();
		}
	});
});

describe("a push the Host refuses", () => {
	/** A run of `walkerId` in the owner's Space, of `project`, with one event. */
	const rowsOf = (walkerId: string, project = projectId) => ({
		runs: [
			{
				id: "run-pushed",
				spaceId: sandbox.spaceId,
				projectId: project,
				flowName: null,
				flow: "{}",
				bodyFlows: "{}",
				title: "Pushed",
				worktreePath: "",
				branch: "nightshift/pushed",
				baseRef: "main",
				walkerId,
				startedBy: ownerId,
				deviceId: null,
				placements: null,
				deviceNames: null,
				createdAt: Date.now(),
			},
		],
		steps: [],
		sessions: [],
		events: [
			{
				spaceId: sandbox.spaceId,
				runId: "run-pushed",
				stepId: null,
				sessionId: null,
				type: "RunStarted",
				payload: "{}",
				at: Date.now(),
				walkerId,
				walkerSeq: 1,
			},
		],
	});

	/** The code of the ORPCError a call ends in. */
	async function codeOf(promise: Promise<unknown>) {
		const error = await promise.then(
			() => null,
			(e: unknown) => e,
		);
		expect(error).toBeInstanceOf(ORPCError);
		return (error as ORPCError<string, unknown>).code;
	}

	test("is FORBIDDEN for another Walker's row, and CONFLICT for a project it lacks yet", async () => {
		const mine = keyOf("device-mine", ownerId);
		expect(await codeOf(host().push(mine, rowsOf("device-colleague")))).toBe(
			"FORBIDDEN",
		);
		expect(
			await codeOf(host().push(mine, rowsOf("device-mine", "project-later"))),
		).toBe("CONFLICT");
		expect(await sandbox.db.select().from(runTable)).toEqual([]);
		// The same batch from its own Walker is taken.
		expect(await host().push(mine, rowsOf("device-mine"))).toEqual({
			events: 1,
		});
	});
});

describe("a Device's stream of rows", () => {
	test("wakes for another Walker's rows of its Person's Spaces only", async () => {
		// A Space the colleague is not a Member of, with a run.
		await sandbox.db.insert(organization).values({
			id: "space-other",
			name: "Other",
			slug: "space-other",
			createdAt: new Date(),
		});
		await sandbox.db
			.insert(projectTable)
			.values({ id: "p-other", spaceId: "space-other", name: "other" });
		const runRow = (id: string, spaceId: string, ofProject: string) => ({
			id,
			spaceId,
			projectId: ofProject,
			flow: "{}",
			title: id,
			worktreePath: "/w",
			branch: "b",
			baseRef: "main",
			walkerId: sandbox.deviceId,
		});
		await sandbox.db
			.insert(runTable)
			.values([
				runRow("run-shared", sandbox.spaceId, projectId),
				runRow("run-other", "space-other", "p-other"),
			]);
		const edge = (runId: string) => ({
			type: "EdgeTaken" as const,
			runId,
			payload: { edgeId: "e", from: "a", to: "b", outcome: "pass" },
		});
		// The colleague's Device has its own rows: they never wake its stream.
		const own = (walkerSeq: number) => ({
			spaceId: sandbox.spaceId,
			runId: "run-shared",
			stepId: null,
			sessionId: null,
			type: "EdgeTaken",
			payload: "{}",
			at: Date.now(),
			walkerId: "device-colleague",
			walkerSeq,
		});

		let reads = 0;
		const rowsAfter = engine.exchange.rowsAfter;
		engine.exchange.rowsAfter = (input) => {
			reads++;
			return rowsAfter(input);
		};
		const stop = new AbortController();
		try {
			const rows = host()
				.stream(
					keyOf("device-colleague", "colleague"),
					{ cursors: {} },
					stop.signal,
				)
				[Symbol.asyncIterator]();
			const next = rows.next();
			await waitFor(() => reads === 1, { label: "the first read" });

			await runLog.append(edge("run-other"));
			await runLog.ingest([own(1)]);
			// A spend so far goes with the next row that wakes it.
			await runLog.append({
				type: "SessionUsage",
				runId: "run-shared",
				payload: { usage: {}, costUsd: null } as never,
			});
			await Bun.sleep(100);
			expect(reads).toBe(1);

			await runLog.append(edge("run-shared"));
			const batch = (await next).value;
			expect(reads).toBe(2);
			const events: SyncBatch["rows"]["events"] = batch
				? batch.rows.events
				: [];
			expect(events.map((e) => [e.runId, e.type])).toEqual([
				["run-shared", "SessionUsage"],
				["run-shared", "EdgeTaken"],
			]);
		} finally {
			stop.abort();
			engine.exchange.rowsAfter = rowsAfter;
		}
	});
});
