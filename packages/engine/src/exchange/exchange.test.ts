import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import {
	agentSession,
	event,
	member,
	organization,
	project,
	user,
} from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
import { and, eq } from "drizzle-orm";

import { createEngine } from "../engine";
import { createRunLog } from "../run-log";
import {
	createSandbox,
	expectRunLogsInSync,
	type Sandbox,
	waitFor,
	withDevice,
} from "../test-support";
import type { Engine, Relay, RunStatus } from "../types";
import {
	ForeignRowsError,
	MissingProjectError,
	NO_ROWS,
	withoutPrivatePaths,
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

function engineOf(
	sandbox: Sandbox,
	options: { relay?: Relay; harness?: ReturnType<typeof fakeHarness> } = {},
): Engine {
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: options.harness ? { "claude-code": options.harness } : {},
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
			...(options.relay ? { relay: options.relay } : {}),
		}),
		{ runLog: createRunLog(sandbox.db) },
	);
}

async function statusOf(engine: Engine, spaceId: string, runId: string) {
	return (await engine.space(spaceId).getRun(runId)).status;
}

async function untilStatus(
	engine: Engine,
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

/** Everything of A's Walker in A's Space after B's cursors, into B. */
async function exchange(engineA: Engine, engineB: Engine) {
	const cursors = await engineB.exchange.rows.cursorsWith(HOST);
	const { rows, cursors: moved } = await engineA.exchange.rows.rowsAfter({
		spaces: [a.spaceId],
		cursors,
		except: b.deviceId,
	});
	const added = await engineB.exchange.rows.ingest(rows);
	await engineB.exchange.rows.advance(HOST, moved);
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

		const first = await exchange(engineA, engineB);
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
		expect(await exchange(engineA, engineB)).toEqual([]);
		const again = await engineA.exchange.rows.rowsAfter({
			spaces: [a.spaceId],
			cursors: {},
			except: b.deviceId,
		});
		expect(await engineB.exchange.rows.ingest(again.rows)).toEqual([]);

		// A answers; the rest comes after the cursor only.
		const gate = (await engineA.space(a.spaceId).listGates())[0];
		await engineA.space(a.spaceId).resolveGate({
			runId: run.id,
			stepId: gate?.stepId as string,
			choice: "approve",
		});
		await untilStatus(engineA, a.spaceId, run.id, "finished");
		const rest = await exchange(engineA, engineB);
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
				version: 5,
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
		await exchange(engineA, engineB);
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
		const { rows } = await engineA.exchange.rows.rowsAfter({
			spaces: [a.spaceId],
			cursors: {},
		});

		// Before the Space document brought the project: not yet.
		expect(engineB.exchange.rows.ingest(rows)).rejects.toBeInstanceOf(
			MissingProjectError,
		);
		await projectOnB(projectId);

		expect(
			engineB.exchange.rows.ingest(rows, { walker: "someone-else" }),
		).rejects.toBeInstanceOf(ForeignRowsError);
		expect(
			engineB.exchange.rows.ingest(rows, {
				walker: a.deviceId,
				spaces: ["another-space"],
			}),
		).rejects.toBeInstanceOf(ForeignRowsError);
		// An event that names a run of another Walker is refused too.
		const forged = {
			...NO_ROWS,
			events: [{ ...rows.events[0], walkerId: "someone-else" }],
		} as typeof rows;
		await engineB.exchange.rows.ingest(rows, {
			walker: a.deviceId,
			spaces: [a.spaceId],
		});
		expect(
			engineB.exchange.rows.ingest(forged, { walker: "someone-else" }),
		).rejects.toBeInstanceOf(ForeignRowsError);
		expect(await statusOf(engineB, a.spaceId, run.id)).toBe("waiting");
	});

	test("cursors move forward per Host, Space and Walker, never back", async () => {
		const engineB = engineOf(b);
		const { rows } = engineB.exchange;
		await rows.advance(HOST, { s1: { w1: 5, w2: 3 } });
		await rows.advance(HOST, { s1: { w1: 2 }, s2: { w1: 7 } });
		await rows.advance("another-host", { s1: { w1: 9 } });
		expect(await rows.cursorsWith(HOST)).toEqual({
			s1: { w1: 5, w2: 3 },
			s2: { w1: 7 },
		});
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
		await exchange(engineA, engineB);
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
		expect((await commands.pendingOf("run-1")).map((c) => c.id)).toEqual([
			kept.id,
		]);
		// Only its Walker may say it is done.
		await commands.done(kept.id, "device-c", null);
		expect(await commands.pendingFor("device-b")).toHaveLength(1);
		await commands.done(kept.id, "device-b", null);
		expect(await commands.pendingFor("device-b")).toEqual([]);
	});
});

describe("a Walker's paths", () => {
	test("leave the rows for another Person, with the rows' shape kept", async () => {
		const engineA = engineOf(a);
		const { id: projectId } = await engineA
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath });
		const run = await engineA
			.space(a.spaceId)
			.startRun({ projectId, flow: gateFlow });
		await untilStatus(engineA, a.spaceId, run.id, "waiting");
		const { rows } = await engineA.exchange.rows.rowsAfter({
			spaces: [a.spaceId],
			cursors: {},
		});
		const payloadOf = (r: typeof rows, type: string) =>
			JSON.parse(r.events.find((e) => e.type === type)?.payload ?? "{}");
		expect(rows.runs[0]?.worktreePath).toContain(a.root);
		expect(payloadOf(rows, "StepStarted").logPath).toContain(a.dataDir);

		const stripped = withoutPrivatePaths(rows);
		expect(stripped.runs[0]?.worktreePath).toBe("");
		expect(stripped.steps.every((s) => s.transcriptPath === "")).toBe(true);
		expect(payloadOf(stripped, "WorktreeCreated")).toMatchObject({
			worktreePath: "",
			branch: rows.runs[0]?.branch,
		});
		const started = payloadOf(stripped, "StepStarted");
		expect(started).toMatchObject({
			transcriptPath: "",
			logPath: "",
			nodeId: "hello",
		});
		// Nothing else changes, and nothing at all for a Walker that keeps them.
		expect(stripped.events.map((e) => [e.walkerSeq, e.type])).toEqual(
			rows.events.map((e) => [e.walkerSeq, e.type]),
		);
		expect(withoutPrivatePaths(rows, (w) => w === a.deviceId)).toEqual(rows);
	});
});

describe("projects of a Space without a Clone here", () => {
	test("are listed, and what needs their folder says so", async () => {
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
		expect(engineB.space(a.spaceId).listFlows(projectId)).rejects.toThrow(
			"not on this computer",
		);
		expect(
			engineB.space(a.spaceId).startRun({ projectId, flow: gateFlow }),
		).rejects.toThrow("not on this computer");
	});
});

describe("the Spaces of a Host", () => {
	test("a listed Space becomes a Space here, for this computer's Person, in the Host's role", async () => {
		const engineB = engineOf(b);
		const { hostSpaces } = engineB.exchange;
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
		const runLog = createRunLog(b.db);
		const engineA = engineOf(a);
		const engineB = createEngine(
			withDevice({
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
		await exchange(engineA, engineB);
		expect(landed).toContain("GateOpened");
		await runLog.events(run.id);
		await expectRunLogsInSync(b.db, [runLog]);
	});
});
