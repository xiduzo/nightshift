import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import {
	agentSession,
	event,
	member,
	organization,
	project,
	run as runTable,
	user,
} from "@nightshift/db/schema";
import type { WalkRef } from "@nightshift/engine";
import {
	createSpaceDocuments,
	type SpaceDocuments,
} from "@nightshift/engine/projects";
import type { RunStatus } from "@nightshift/engine/run-status";
import {
	createRunLog,
	createSandbox,
	expectRunLogsInSync,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow } from "@nightshift/flows";
import { and, eq, max, sql } from "drizzle-orm";
import type { HostRelay as Relay, RunCommand } from "../contract";
import { createPeerEngine, deviceDirectory, type PeerEngine } from "../peers";
import { withPeers } from "../testing";
import {
	ForeignRowsError,
	MissingProjectError,
	mergeCursors,
	NO_ROWS,
} from "./rows";

/**
 * The exchange between two Replicas, in one process: A walks runs, B gets
 * them by cursor. Each has its own database and its own Device.
 */

let a: Sandbox;
let b: Sandbox;
beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
});
afterEach(async () => {
	await Promise.all([a.cleanup(), b.cleanup()]);
});

const HOST = "the-host";

/** A command, then a Gate. */
const gateFlow: Flow = {
	version: 7,
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
		{
			id: "ship",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "Ship it?",
			options: [{ name: "approve" }, { name: "reject" }],
			by: "person",
			decider: "typesafe",
		},
	],
	edges: [{ id: "e1", from: "hello", outcome: "pass", to: "ship" }],
} as Flow;

/** The run log of each sandbox's latest engine: the events a test logs land through it. */
const runLogs = new Map<Sandbox, ReturnType<typeof createRunLog>>();

function engineOf(
	sandbox: Sandbox,
	options: {
		relay?: Relay;
		harness?: ReturnType<typeof fakeHarness>;
		documents?: SpaceDocuments;
	} = {},
): PeerEngine {
	return createPeerEngine(
		withPeers({
			db: sandbox.db,
			harnesses: options.harness ? { "claude-code": options.harness } : {},
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
			...(options.relay ? { relay: options.relay } : {}),
			...(options.documents ? { spaceDocuments: options.documents } : {}),
		}),
		{ runLog: runLogFor(sandbox) },
	);
}

function runLogFor(sandbox: Sandbox) {
	const runLog = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
	runLogs.set(sandbox, runLog);
	return runLog;
}

async function statusOf(engine: PeerEngine, spaceId: string, runId: string) {
	return (await engine.space(spaceId).getRun(runId)).status;
}

async function untilStatus(
	engine: PeerEngine,
	spaceId: string,
	runId: string,
	status: RunStatus,
) {
	await waitFor(
		async () => (await statusOf(engine, spaceId, runId)) === status,
		{
			label: `status ${status}`,
		},
	);
}

/** B gets A's project row, as the Space document would bring it. */
async function projectOnB(projectId: string) {
	const [row] = await a.db
		.select()
		.from(project)
		.where(eq(project.id, projectId));
	if (!row) throw new Error("no project");
	await b.db.insert(project).values(row);
}

/**
 * Everything of A's Walker in A's Space after B's cursors, into B: the
 * rows, without the Device's loop (device-exchange.test.ts tests that).
 */
async function copyRows(engineA: PeerEngine, engineB: PeerEngine) {
	const cursors = await engineB.exchange.cursorsWith(HOST);
	const { rows, cursors: moved } = await engineA.exchange.rowsAfter({
		spaces: [a.spaceId],
		cursors,
		except: b.deviceId,
	});
	const added = await engineB.exchange.ingest(rows);
	await engineB.exchange.advance(HOST, moved);
	return added;
}

describe("the run history exchange", () => {
	test("B gets A's run by cursor, once, and derives the same status", async () => {
		const engineA = engineOf(a);
		const engineB = engineOf(b);
		const { id: projectId } = await engineA
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath });
		await projectOnB(projectId);
		const run = await engineA
			.space(a.spaceId)
			.startRun({ projectId, flow: gateFlow });
		await untilStatus(engineA, a.spaceId, run.id, "waiting");

		const first = await copyRows(engineA, engineB);
		expect(first.length).toBeGreaterThan(0);
		// Facts of no run (ProjectAdded) stay with their Replica.
		expect(first.every((e) => e.runId === run.id)).toBe(true);
		expect(await statusOf(engineB, a.spaceId, run.id)).toBe("waiting");
		const onB = await engineB.space(a.spaceId).getRun(run.id);
		expect(onB.walker).toMatchObject({ id: a.deviceId, thisDevice: false });
		expect(onB.takeOverCommand).toBeNull();
		expect((await engineB.space(a.spaceId).listGates())[0]).toMatchObject({
			runId: run.id,
			walker: { id: a.deviceId, thisDevice: false },
			answerPending: false,
		});

		// The same rows again: nothing new.
		expect(await copyRows(engineA, engineB)).toEqual([]);
		const again = await engineA.exchange.rowsAfter({
			spaces: [a.spaceId],
			cursors: {},
			except: b.deviceId,
		});
		expect(await engineB.exchange.ingest(again.rows)).toEqual([]);

		// A answers; the rest comes after the cursor only.
		const gate = (await engineA.space(a.spaceId).listGates())[0];
		await engineA.space(a.spaceId).resolveGate({
			runId: run.id,
			stepId: gate?.stepId as string,
			choice: "approve",
		});
		await untilStatus(engineA, a.spaceId, run.id, "finished");
		const rest = await copyRows(engineA, engineB);
		expect(rest[0]?.seq).toBeGreaterThan(first.at(-1)?.seq ?? 0);
		expect(await statusOf(engineB, a.spaceId, run.id)).toBe("finished");
		expect(await engineB.space(a.spaceId).listGates()).toEqual([]);

		// The walker's order, its identity and its time came along.
		const own = await a.db
			.select()
			.from(event)
			.where(eq(event.runId, run.id))
			.orderBy(event.walkerSeq);
		const copied = await b.db
			.select()
			.from(event)
			.where(eq(event.runId, run.id))
			.orderBy(event.seq);
		expect(copied.map((e) => [e.walkerId, e.walkerSeq, e.type, e.at])).toEqual(
			own.map((e) => [e.walkerId, e.walkerSeq, e.type, e.at]),
		);
	});

	test("a session's harness id comes from its HarnessSessionAssigned event", async () => {
		const harness = fakeHarness(() => reportingScript("pass", "Done."));
		const engineA = engineOf(a, { harness });
		const engineB = engineOf(b);
		const { id: projectId } = await engineA
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath });
		await projectOnB(projectId);
		const run = await engineA.space(a.spaceId).startRun({
			projectId,
			flow: {
				version: 7,
				inputs: [],
				outputs: [],
				start: "agent",
				nodes: [
					{
						id: "agent",
						type: "agent",
						position: { x: 0, y: 0 },
						prompt: "Go",
						harness: "claude-code",
						model: "sonnet",
						permissionMode: "acceptEdits",
						session: "fresh",
					},
				],
				edges: [],
			} as Flow,
		});
		await untilStatus(engineA, a.spaceId, run.id, "finished");
		await copyRows(engineA, engineB);
		const [onA] = await a.db
			.select()
			.from(agentSession)
			.where(eq(agentSession.runId, run.id));
		const [onB] = await b.db
			.select()
			.from(agentSession)
			.where(eq(agentSession.runId, run.id));
		expect(onA?.harnessSessionId).toBeTruthy();
		expect(onB?.harnessSessionId).toBe(onA?.harnessSessionId as string);
	});

	test("a batch with another Walker's row, or another Space's, is refused whole; a missing project is not yet", async () => {
		const engineA = engineOf(a);
		const engineB = engineOf(b);
		const { id: projectId } = await engineA
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath });
		const run = await engineA
			.space(a.spaceId)
			.startRun({ projectId, flow: gateFlow });
		await untilStatus(engineA, a.spaceId, run.id, "waiting");
		const { rows } = await engineA.exchange.rowsAfter({
			spaces: [a.spaceId],
			cursors: {},
		});

		// Before the Space document brought the project: not yet.
		expect(engineB.exchange.ingest(rows)).rejects.toBeInstanceOf(
			MissingProjectError,
		);
		await projectOnB(projectId);

		expect(
			engineB.exchange.ingest(rows, { walker: "someone-else" }),
		).rejects.toBeInstanceOf(ForeignRowsError);
		expect(
			engineB.exchange.ingest(rows, {
				walker: a.deviceId,
				spaces: ["another-space"],
			}),
		).rejects.toBeInstanceOf(ForeignRowsError);
		// An event that names a run of another Walker is refused too.
		const forged = {
			...NO_ROWS,
			events: [{ ...rows.events[0], walkerId: "someone-else" }],
		} as typeof rows;
		await engineB.exchange.ingest(rows, {
			walker: a.deviceId,
			spaces: [a.spaceId],
		});
		expect(
			engineB.exchange.ingest(forged, { walker: "someone-else" }),
		).rejects.toBeInstanceOf(ForeignRowsError);
		expect(await statusOf(engineB, a.spaceId, run.id)).toBe("waiting");
	});

	test("cursors move forward per Host, Space and Walker, never back", async () => {
		const engineB = engineOf(b);
		const { exchange } = engineB;
		await exchange.advance(HOST, { s1: { w1: 5, w2: 3 } });
		await exchange.advance(HOST, { s1: { w1: 2 }, s2: { w1: 7 } });
		await exchange.advance("another-host", { s1: { w1: 9 } });
		expect(await exchange.cursorsWith(HOST)).toEqual({
			s1: { w1: 5, w2: 3 },
			s2: { w1: 7 },
		});
	});
});

describe("a batch and what follows from it", () => {
	/** A's run of `gateFlow`, waiting at its Gate, with its project on B. */
	async function waitingOnA(engineA: PeerEngine) {
		const { id: projectId } = await engineA
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath });
		await projectOnB(projectId);
		const run = await engineA
			.space(a.spaceId)
			.startRun({ projectId, flow: gateFlow });
		await untilStatus(engineA, a.spaceId, run.id, "waiting");
		return { projectId, runId: run.id };
	}

	/** An event of the run in `sandbox`'s log, as `walkerId`'s next: a fixture, past the engine. */
	async function logOn(
		sandbox: Sandbox,
		runId: string,
		walkerId: string,
		type: string,
		payload: object,
	) {
		const [counted] = await sandbox.db
			.select({ latest: max(event.walkerSeq) })
			.from(event)
			.where(eq(event.walkerId, walkerId));
		// Through the run log, as every event lands.
		await (runLogs.get(sandbox) ?? runLogFor(sandbox)).ingest([
			{
				spaceId: a.spaceId,
				runId,
				stepId: null,
				sessionId: null,
				type,
				payload: JSON.stringify(payload),
				at: Date.now(),
				walkerId,
				walkerSeq: (counted?.latest ?? 0) + 1,
			},
		]);
	}

	/** The types of the run's events on a Replica, in the order they landed there. */
	async function typesOn(sandbox: Sandbox, runId: string) {
		return (
			await sandbox.db
				.select()
				.from(event)
				.where(eq(event.runId, runId))
				.orderBy(event.seq)
		).map((e) => `${e.walkerId === a.deviceId ? "A" : e.walkerId}:${e.type}`);
	}

	/** A relay whose archive answers with `archive`. */
	function relayOf(archive: (ref: WalkRef) => Promise<string | null>): Relay {
		return {
			command: async () => {},
			addClone: async () => {},
			reachable: async () => false,
			archive,
			archivePut: async () => {},
			startRun: async () => {
				throw new Error("not in this test");
			},
			offer: async () => {},
			withdrawOffer: async () => {},
			devices: async () => [],
		};
	}

	/**
	 * A moves its run to B, as `moveRun` does: its walk state into the
	 * archive (returned, by kind and step), then `WalkerMoved` as its last
	 * event.
	 */
	async function moveToB(engineA: PeerEngine, runId: string) {
		const files = new Map<string, string>();
		const own = async (ref: WalkRef) => {
			const content = await engineA.exchange.archive.own(ref);
			if (content !== null) files.set(fileKey(ref), content);
		};
		await own({ kind: "checkpoint", spaceId: a.spaceId, runId });
		for (const { id } of (await engineA.space(a.spaceId).getRun(runId)).steps) {
			await own({ kind: "transcript", spaceId: a.spaceId, runId, stepId: id });
		}
		await logOn(a, runId, a.deviceId, "WalkerMoved", {
			from: a.deviceId,
			to: b.deviceId,
			by: null,
		});
		return files;
	}

	const fileKey = (ref: WalkRef) =>
		ref.kind === "checkpoint" ? ref.kind : `${ref.kind}:${ref.stepId}`;

	test("lands whole or not at all: a crash before the run's Walker moved repeats the move when the batch comes again", async () => {
		const engineA = engineOf(a);
		const engineB = engineOf(b);
		const { runId } = await waitingOnA(engineA);
		await logOn(a, runId, a.deviceId, "WalkerMoved", {
			from: a.deviceId,
			to: "device-c",
			by: null,
		});
		// B stops as it gives the run its new Walker.
		await b.db.run(
			sql.raw(
				"create trigger stop_here before update of walker_id on run begin select raise(abort, 'The computer stopped.'); end",
			),
		);
		await expect(copyRows(engineA, engineB)).rejects.toThrow();
		// Nothing of the batch landed, not even in the run log in memory.
		expect(await typesOn(b, runId)).toEqual([]);
		await expect(engineB.space(a.spaceId).getRun(runId)).rejects.toThrow();
		expect(await engineB.exchange.cursorsWith(HOST)).toEqual({});

		// B starts again, and the batch comes again: all of it lands.
		await b.db.run(sql.raw("drop trigger stop_here"));
		await copyRows(engineA, engineB);
		expect(await typesOn(b, runId)).toEqual(await typesOn(a, runId));
		expect((await engineB.space(a.spaceId).getRun(runId)).walker.id).toBe(
			"device-c",
		);

		// A Replica that an older build left with the old Walker gets the
		// new one back when the batch comes again.
		await b.db
			.update(runTable)
			.set({ walkerId: a.deviceId })
			.where(eq(runTable.id, runId));
		const again = await engineA.exchange.rowsAfter({
			spaces: [a.spaceId],
			cursors: {},
		});
		expect(await engineB.exchange.ingest(again.rows)).toEqual([]);
		expect((await engineB.space(a.spaceId).getRun(runId)).walker.id).toBe(
			"device-c",
		);
	});

	test("comes in the order its events landed on the Host: a third Replica stores a moved run as it happened", async () => {
		const c = await createSandbox();
		try {
			const engineA = engineOf(a);
			// B is the Host here, C another of its Devices.
			const host = engineOf(b);
			const third = engineOf(c);
			const { projectId, runId } = await waitingOnA(engineA);
			const [row] = await a.db
				.select()
				.from(project)
				.where(eq(project.id, projectId));
			await c.db.insert(project).values(row as typeof project.$inferInsert);
			await copyRows(engineA, host);
			// On the Host: A moved the run, then its new Walker went on with it.
			// The new Walker's id sorts before A's, and its count is lower.
			const next = "-next-walker";
			await logOn(b, runId, a.deviceId, "WalkerMoved", {
				from: a.deviceId,
				to: next,
				by: null,
			});
			await logOn(b, runId, next, "WalkerArrived", { from: a.deviceId });
			await logOn(b, runId, next, "StopRequested", {});

			const { rows } = await host.exchange.rowsAfter({
				spaces: [a.spaceId],
				cursors: {},
				limit: 3,
			});
			// The first batch is the run's start: the new Walker's events wait.
			expect(rows.events.every((e) => e.walkerId === a.deviceId)).toBe(true);
			let cursors = {};
			while (true) {
				const batch = await host.exchange.rowsAfter({
					spaces: [a.spaceId],
					cursors,
					limit: 3,
				});
				if (batch.rows.events.length === 0) break;
				await third.exchange.ingest(batch.rows);
				cursors = mergeCursors(cursors, batch.cursors);
			}
			expect(await typesOn(c, runId)).toEqual(await typesOn(b, runId));
			expect((await typesOn(c, runId)).slice(-3)).toEqual([
				"A:WalkerMoved",
				`${next}:WalkerArrived`,
				`${next}:StopRequested`,
			]);
		} finally {
			await c.cleanup();
		}
	});

	test("a run moved here is taken over again until it arrives", async () => {
		let archive = new Map<string, string>();
		const engineA = engineOf(a);
		const engineB = engineOf(b, {
			relay: relayOf(async (ref) => archive.get(fileKey(ref)) ?? null),
		});
		const { runId } = await waitingOnA(engineA);
		const files = await moveToB(engineA, runId);
		// The archive does not have the run's walk state yet.
		await copyRows(engineA, engineB);
		expect((await engineB.space(a.spaceId).getRun(runId)).walker.id).toBe(
			b.deviceId,
		);
		await Bun.sleep(200);
		expect(await typesOn(b, runId)).not.toContain(
			`${b.deviceId}:WalkerArrived`,
		);

		// It is there now: the next try takes the run over.
		archive = files;
		await waitFor(
			async () =>
				(await typesOn(b, runId)).at(-1) === `${b.deviceId}:WalkerArrived`,
			{ label: "the run to arrive", timeoutMs: 15_000 },
		);
		expect(await statusOf(engineB, a.spaceId, runId)).toBe("waiting");
	});

	test("a Command that comes before its run arrived is applied once it arrived: never lost, never twice", async () => {
		let archive = new Map<string, string>();
		// B's copy of A's Space: Ada is a Member there.
		const documents = createSpaceDocuments({
			db: b.db,
			directory: deviceDirectory(b.db),
		});
		try {
			const space = await documents.open(a.spaceId);
			space.doc.transact(() => {
				space.members.set("person-ada", { name: "Ada", role: "member" });
			});
			const engineA = engineOf(a);
			const engineB = engineOf(b, {
				relay: relayOf(async (ref) => archive.get(fileKey(ref)) ?? null),
				documents,
			});
			const { runId } = await waitingOnA(engineA);
			const files = await moveToB(engineA, runId);
			const gate = (await engineA.space(a.spaceId).getRun(runId)).steps.at(-1);
			const command: RunCommand = {
				id: "command-1",
				spaceId: a.spaceId,
				runId,
				walkerId: b.deviceId,
				personId: "person-ada",
				createdAt: Date.now(),
				kind: "gate.resolve",
				payload: { stepId: gate?.id as string, choice: "approve" },
			};

			// The rows that move the run to B are not here yet, however long
			// they take: not "done, with an error", it comes again. At once,
			// so the Commands of other runs never wait behind it.
			const asked = Date.now();
			await expect(engineB.exchange.apply(command, engineB)).rejects.toThrow(
				"The run is still on its way to this device.",
			);
			expect(Date.now() - asked).toBeLessThan(5_000);

			// The rows that move the run to B are here; its walk state is not.
			await copyRows(engineA, engineB);
			const before = await typesOn(b, runId);
			await expect(engineB.exchange.apply(command, engineB)).rejects.toThrow(
				"The run is still on its way to this device.",
			);
			expect(await typesOn(b, runId)).toEqual(before);

			// The walk state is in the archive now: the run arrives, then the
			// Command is applied, once, however often it comes.
			archive = files;
			expect(await engineB.exchange.apply(command, engineB)).toBeNull();
			expect(await engineB.exchange.apply(command, engineB)).toBeNull();
			await untilStatus(engineB, a.spaceId, runId, "finished");
			const types = (await typesOn(b, runId)).slice(before.length);
			expect(types[0]).toBe(`${b.deviceId}:WalkerArrived`);
			const answers = (
				await b.db.select().from(event).where(eq(event.runId, runId))
			).filter(
				(e) =>
					e.type === "StepEnded" && JSON.parse(e.payload).outcome === "approve",
			);
			expect(answers).toHaveLength(1);
			expect(JSON.parse(answers[0]?.payload as string).commandId).toBe(
				"command-1",
			);
			await engineB.dispose();
			await engineA.dispose();
		} finally {
			await documents.close();
		}
	});

	test("a Command for a run that moved on from here, or that ended elsewhere, is done with why", async () => {
		const engineA = engineOf(a);
		const engineB = engineOf(b);
		const { projectId, runId } = await waitingOnA(engineA);
		const command = (walkerId: string): RunCommand => ({
			id: `command-${walkerId}`,
			spaceId: a.spaceId,
			runId,
			walkerId,
			personId: "person-a",
			createdAt: Date.now(),
			kind: "signal.send",
			payload: { name: "go" },
		});

		// Another run of A finished there: it never moves to B any more.
		const ended = await engineA
			.space(a.spaceId)
			.startRun({ projectId, flow: gateFlow });
		await untilStatus(engineA, a.spaceId, ended.id, "waiting");
		const gate = (await engineA.space(a.spaceId).listGates()).find(
			(g) => g.runId === ended.id,
		);
		await engineA.space(a.spaceId).resolveGate({
			runId: ended.id,
			stepId: gate?.stepId as string,
			choice: "approve",
		});
		await untilStatus(engineA, a.spaceId, ended.id, "finished");
		await copyRows(engineA, engineB);
		expect(
			await engineB.exchange.apply(
				{ ...command(b.deviceId), runId: ended.id },
				engineB,
			),
		).toBe("The run ended before this reached it.");

		// A moved the first run on to B: a Command for A that comes now is not
		// A's. (The move is a fixture past the engine: a fresh engine reads it.)
		await moveToB(engineA, runId);
		await a.db
			.update(runTable)
			.set({ walkerId: b.deviceId })
			.where(eq(runTable.id, runId));
		await engineA.dispose();
		const restarted = engineOf(a);
		expect(await restarted.exchange.apply(command(a.deviceId), restarted)).toBe(
			"The run moved to another device before this reached it.",
		);
		await engineB.dispose();
		await restarted.dispose();
	});

	test("a run moved here that a restart cut short is taken over when the next engine is ready", async () => {
		let archive = new Map<string, string>();
		const relay = relayOf(async (ref) => archive.get(fileKey(ref)) ?? null);
		const engineA = engineOf(a);
		const before = engineOf(b, { relay });
		const { runId } = await waitingOnA(engineA);
		const files = await moveToB(engineA, runId);
		await copyRows(engineA, before);
		await Bun.sleep(200);
		await before.dispose();
		expect(await typesOn(b, runId)).not.toContain(
			`${b.deviceId}:WalkerArrived`,
		);

		archive = files;
		const after = engineOf(b, { relay });
		await waitFor(
			async () =>
				(await typesOn(b, runId)).at(-1) === `${b.deviceId}:WalkerArrived`,
			{ label: "the run to arrive", timeoutMs: 15_000 },
		);
		expect(await statusOf(after, a.spaceId, runId)).toBe("waiting");
	});
});

describe("a run walked elsewhere", () => {
	/** A's run, waiting at its Gate, on B. */
	async function waitingOnB(relay?: Relay) {
		const engineA = engineOf(a);
		const engineB = engineOf(b, relay ? { relay } : {});
		const { id: projectId } = await engineA
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath });
		await projectOnB(projectId);
		const run = await engineA
			.space(a.spaceId)
			.startRun({ projectId, flow: gateFlow });
		await untilStatus(engineA, a.spaceId, run.id, "waiting");
		await copyRows(engineA, engineB);
		const gate = (await engineB.space(a.spaceId).listGates())[0];
		return { engineA, engineB, run, stepId: gate?.stepId as string };
	}

	test("answering its Gate, signalling and stopping travel to its Walker as commands", async () => {
		const sent: Parameters<Relay["command"]>[0][] = [];
		const relay: Relay = {
			command: async (command) => {
				sent.push(command);
			},
			addClone: async () => {},
			reachable: async () => false,
			archive: async () => null,
			archivePut: async () => {},
			startRun: async () => {
				throw new Error("not in this test");
			},
			offer: async () => {},
			withdrawOffer: async () => {},
			devices: async () => [],
		};
		const { engineB, run, stepId } = await waitingOnB(relay);
		const space = engineB.space(a.spaceId, { personId: "person-a" });

		await space.resolveGate({ runId: run.id, stepId, choice: "approve" });
		await space.stopRun(run.id, { when: "after-step" });
		expect(sent).toEqual([
			{
				kind: "gate.resolve",
				payload: { stepId, choice: "approve" },
				spaceId: a.spaceId,
				runId: run.id,
				walkerId: a.deviceId,
				personId: "person-a",
			},
			{
				kind: "run.stop",
				payload: { when: "after-step" },
				spaceId: a.spaceId,
				runId: run.id,
				walkerId: a.deviceId,
				personId: "person-a",
			},
		]);
		// Nothing was written here: the Walker writes its run's events.
		expect(await statusOf(engineB, a.spaceId, run.id)).toBe("waiting");
		// A wrong answer is refused here, before it travels.
		expect(
			space.resolveGate({ runId: run.id, stepId, choice: "maybe" }),
		).rejects.toThrow();
		expect(space.signalRun(run.id, "go")).rejects.toThrow(
			"does not wait for that signal",
		);
	});

	test("it is never resumed or recovered here, and without a relay it is read-only", async () => {
		const { engineB, run, stepId } = await waitingOnB();
		expect(engineB.space(a.spaceId).resumeRun(run.id)).rejects.toThrow(
			"Another device",
		);
		expect(
			engineB
				.space(a.spaceId, { personId: "p" })
				.resolveGate({ runId: run.id, stepId, choice: "approve" }),
		).rejects.toThrow("cannot reach");

		// A new daemon on B's Replica leaves A's open run alone.
		const before = await b.db
			.select()
			.from(event)
			.where(eq(event.runId, run.id));
		const restarted = engineOf(b);
		await restarted.space(b.spaceId).listProjects();
		await Bun.sleep(50);
		const after = await b.db
			.select()
			.from(event)
			.where(eq(event.runId, run.id));
		expect(after).toHaveLength(before.length);
		expect(await statusOf(restarted, a.spaceId, run.id)).toBe("waiting");
	});

	test("an ended step's transcript comes from the Host's archive once, and is kept here", async () => {
		const files = new Map<string, string>();
		const fetched: string[] = [];
		const relay: Relay = {
			command: async () => {},
			addClone: async () => {},
			reachable: async () => false,
			archive: async (ref) => {
				fetched.push(ref.kind === "checkpoint" ? ref.kind : ref.stepId);
				return ref.kind === "transcript"
					? (files.get(ref.stepId) ?? null)
					: null;
			},
			archivePut: async () => {},
			startRun: async () => {
				throw new Error("not in this test");
			},
			offer: async () => {},
			withdrawOffer: async () => {},
			devices: async () => [],
		};
		const { engineA, engineB, run } = await waitingOnB(relay);
		// The Host has A's files: A pushed them when the command ended.
		for (const { id } of (await engineA.space(a.spaceId).getRun(run.id))
			.steps) {
			const ref = {
				kind: "transcript" as const,
				spaceId: a.spaceId,
				runId: run.id,
				stepId: id,
			};
			const content = await engineA.exchange.archive.own(ref);
			if (content !== null) files.set(id, content);
		}
		const hello = (await engineB.space(a.spaceId).getRun(run.id)).steps[0];
		const step = { spaceId: a.spaceId, runId: run.id, stepId: hello?.id ?? "" };
		const read = async () => {
			const texts: string[] = [];
			for await (const entry of engineB.exchange.feeds.entries(
				step,
				0,
				new AbortController().signal,
			)) {
				if (entry.event.type === "command-output") {
					texts.push(entry.event.text.trim());
				}
			}
			return texts;
		};
		expect(await read()).toEqual(["hello"]);
		expect(await read()).toEqual(["hello"]);
		expect(fetched).toEqual([step.stepId]);
		expect(
			await engineB.exchange.archive.read({ kind: "transcript", ...step }),
		).toBe(files.get(step.stepId) ?? "");
	});

	test("the Host keeps a command until its Walker reports it done", async () => {
		const engineA = engineOf(a);
		const { commands } = engineA.exchange;
		const kept = await commands.enqueue({
			kind: "signal.send",
			payload: { name: "go" },
			spaceId: a.spaceId,
			runId: "run-1",
			walkerId: "device-b",
			personId: "person-a",
		});
		expect(await commands.pendingFor("device-b")).toEqual([kept]);
		expect((await commands.pendingOf(["run-1"])).map((c) => c.id)).toEqual([
			kept.id,
		]);
		// Only its Walker may say it is done.
		await commands.done(kept.id, "device-c", null);
		expect(await commands.pendingFor("device-b")).toHaveLength(1);
		await commands.done(kept.id, "device-b", null);
		expect(await commands.pendingFor("device-b")).toEqual([]);
	});
});

describe("projects of a Space without a Clone here", () => {
	test("are listed with their flows, and what needs their folder says so", async () => {
		const engineA = engineOf(a);
		const engineB = engineOf(b);
		const { id: projectId } = await engineA
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath });
		await projectOnB(projectId);
		const listed = await engineB.space(a.spaceId).listProjects();
		expect(listed).toEqual([
			expect.objectContaining({ id: projectId, repoPath: null }),
		]);
		expect(listed[0]?.clones.some((c) => c.thisDevice)).toBe(false);
		expect(await engineB.space(a.spaceId).flows.list(projectId)).toEqual([]);
		expect(
			engineB.space(a.spaceId).startRun({ projectId, flow: gateFlow }),
		).rejects.toThrow("not on this computer");
	});
});

describe("the Spaces of a Host", () => {
	test("a listed Space becomes a Space here, for this computer's Person, in the Host's role", async () => {
		const engineB = engineOf(b);
		const { hostSpaces } = engineB;
		const [person] = await b.db.select().from(user);
		const personId = person?.id as string;
		const host = { id: HOST, name: "studio" };
		await hostSpaces.update(
			host,
			[
				{ id: "space-mine", name: "Personal", personal: true, role: "owner" },
				{ id: "space-team", name: "Platform", personal: false, role: "member" },
				// This Replica's own Space is never taken for the Host's.
				{ id: b.spaceId, name: "Hijack", personal: false, role: "viewer" },
			],
			personId,
		);
		expect(await hostSpaces.ofHost(HOST)).toEqual(
			expect.arrayContaining(["space-mine", "space-team"]),
		);
		expect(await hostSpaces.hostOf(b.spaceId)).toBeNull();
		// Listed by name for the Devices and Settings pages, personal first.
		expect(await hostSpaces.listed(HOST)).toEqual([
			{ id: "space-mine", name: "Personal on studio", personal: true },
			{ id: "space-team", name: "Platform", personal: false },
		]);
		const [mine] = await b.db
			.select()
			.from(organization)
			.where(eq(organization.id, "space-mine"));
		// Not this computer's personal Space: that stays its own.
		expect(mine).toMatchObject({ name: "Personal on studio", personal: false });
		const roleIn = async (spaceId: string) =>
			(
				await b.db
					.select({ role: member.role })
					.from(member)
					.where(
						and(
							eq(member.organizationId, spaceId),
							eq(member.userId, personId),
						),
					)
			)[0]?.role ?? null;
		expect(await roleIn("space-team")).toBe("member");
		expect(await roleIn(b.spaceId)).toBe("owner");

		// The Host stops listing a Space: this computer's Person leaves it here.
		await hostSpaces.update(
			host,
			[{ id: "space-mine", name: "Personal", personal: true, role: "owner" }],
			personId,
		);
		expect(await roleIn("space-team")).toBeNull();
		expect(await hostSpaces.hostOf("space-team")).toBeNull();
	});
});

describe("run logs", () => {
	test("an ingested event is in the run log as on disk", async () => {
		const runLog = createRunLog(b.db, { walkerId: b.deviceId });
		const engineA = engineOf(a);
		const engineB = createPeerEngine(
			withPeers({
				db: b.db,
				harnesses: {},
				deviceId: b.deviceId,
				dataDir: b.dataDir,
				scheduler: false,
			}),
			{ runLog },
		);
		const { id: projectId } = await engineA
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath });
		await projectOnB(projectId);
		const run = await engineA
			.space(a.spaceId)
			.startRun({ projectId, flow: gateFlow });
		// B reads the run while it is empty, then ingests: the copy follows.
		await untilStatus(engineA, a.spaceId, run.id, "waiting");
		const landed: string[] = [];
		runLog.onLanded((events) => landed.push(...events.map((e) => e.type)));
		await copyRows(engineA, engineB);
		expect(landed).toContain("GateOpened");
		await runLog.events(run.id);
		await expectRunLogsInSync(b.db, [runLog]);
	});
});
