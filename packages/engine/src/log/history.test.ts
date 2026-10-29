import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { agentSession, project, run, step } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { createRunBus } from "./bus";
import {
	createRunHistory,
	ForeignRowsError,
	type HistoryRows,
	MissingProjectError,
	type RunHistory,
} from "./history";
import { createRunLog, type RunLog } from "./run-log";

/**
 * The run history of a Replica, as the exchange copies it between
 * Replicas: A walks a run, B takes A's rows by cursor. Two databases in
 * one process, each with its own Device.
 */

type Replica = { sandbox: Sandbox; log: RunLog; history: RunHistory };

function replicaOf(sandbox: Sandbox): Replica {
	const log = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
	const bus = createRunBus();
	return {
		sandbox,
		log,
		history: createRunHistory({
			db: sandbox.db,
			dataDir: sandbox.dataDir,
			log,
			bus,
		}),
	};
}

let a: Replica;
let b: Replica;
let spaceId: string;
beforeEach(async () => {
	const [sa, sb] = await Promise.all([createSandbox(), createSandbox()]);
	a = replicaOf(sa);
	b = replicaOf(sb);
	spaceId = sa.spaceId;
	await sa.db.insert(project).values({ id: "p", spaceId, name: "p" });
});
afterEach(async () => {
	await Promise.all([a.sandbox.cleanup(), b.sandbox.cleanup()]);
});

/** A run A walks, with one step and one agent session, started and stepped in its log. */
async function walkOnA(runId: string) {
	const stepId = `${runId}-s`;
	const sessionId = `${runId}-x`;
	await a.log.append(
		{
			type: "RunStarted",
			runId,
			payload: { projectId: "p", flowName: null, title: runId, start: "n" },
		},
		{
			before: [
				a.sandbox.db.insert(run).values({
					id: runId,
					spaceId,
					projectId: "p",
					flow: "{}",
					title: runId,
					worktreePath: `/work/${runId}`,
					branch: "b",
					baseRef: "main",
					walkerId: a.sandbox.deviceId,
				}),
			],
		},
	);
	await a.log.append(
		{
			type: "StepStarted",
			runId,
			stepId,
			payload: {
				nodeId: "n",
				nodeType: "agent",
				visit: 1,
				transcriptPath: `/logs/${stepId}.ndjson`,
				logPath: null,
			},
		},
		{
			before: [
				a.sandbox.db.insert(step).values({
					id: stepId,
					spaceId,
					runId,
					nodeId: "n",
					nodeType: "agent",
					visit: 1,
					transcriptPath: `/logs/${stepId}.ndjson`,
				}),
				a.sandbox.db.insert(agentSession).values({
					id: sessionId,
					spaceId,
					runId,
					stepId,
					prompt: "go",
				}),
			],
		},
	);
	await a.log.append({
		type: "HarnessSessionAssigned",
		runId,
		stepId,
		sessionId,
		payload: { harnessSessionId: "harness-1", model: null },
	});
	return { stepId, sessionId };
}

/** B gets the project, as the Space document would bring it. */
async function projectOnB() {
	await b.sandbox.db.insert(project).values({ id: "p", spaceId, name: "p" });
}

describe("the rows of a Replica by cursor", () => {
	test("come with the rows they name, in the order they landed, and move the cursors", async () => {
		const { stepId, sessionId } = await walkOnA("r1");
		const { rows, cursors } = await a.history.rowsAfter({
			spaces: [spaceId],
			cursors: {},
		});
		expect(rows.events.map((e) => e.type)).toEqual([
			"RunStarted",
			"StepStarted",
			"HarnessSessionAssigned",
		]);
		expect(rows.runs.map((r) => r.id)).toEqual(["r1"]);
		expect(rows.steps.map((s) => s.id)).toEqual([stepId]);
		expect(rows.sessions.map((s) => s.id)).toEqual([sessionId]);
		expect(typeof rows.runs[0]?.createdAt).toBe("number");
		expect(cursors).toEqual({ [spaceId]: { [a.sandbox.deviceId]: 3 } });

		// After the cursors: nothing.
		const after = await a.history.rowsAfter({ spaces: [spaceId], cursors });
		expect(after.rows.events).toEqual([]);
		expect(after.cursors).toEqual({});
	});

	test("take one Walker's only, or every Walker's but one, at most `limit`", async () => {
		await walkOnA("r1");
		const self = a.sandbox.deviceId;
		const only = await a.history.rowsAfter({
			spaces: [spaceId],
			cursors: {},
			only: self,
			limit: 2,
		});
		expect(only.rows.events.map((e) => e.walkerSeq)).toEqual([1, 2]);
		expect(only.cursors).toEqual({ [spaceId]: { [self]: 2 } });
		const except = await a.history.rowsAfter({
			spaces: [spaceId],
			cursors: {},
			except: self,
		});
		expect(except.rows.events).toEqual([]);
		const otherSpace = await a.history.rowsAfter({
			spaces: ["another-space"],
			cursors: {},
		});
		expect(otherSpace.rows.events).toEqual([]);
	});
});

describe("a batch that lands", () => {
	async function rowsOfA(): Promise<HistoryRows> {
		return (await a.history.rowsAfter({ spaces: [spaceId], cursors: {} })).rows;
	}

	test("adds its rows once, and the columns that follow from the log", async () => {
		const { sessionId } = await walkOnA("r1");
		await projectOnB();
		const rows = await rowsOfA();
		const added = await b.history.ingest(rows, {
			walker: a.sandbox.deviceId,
			spaces: [spaceId],
		});
		expect(added.map((e) => e.type)).toEqual([
			"RunStarted",
			"StepStarted",
			"HarnessSessionAssigned",
		]);
		expect(await b.history.ingest(rows)).toEqual([]);
		expect(await b.history.runOwner("r1")).toEqual({
			walkerId: a.sandbox.deviceId,
			spaceId,
		});
		// The harness id comes from the event, not from A's row.
		const [session] = await b.sandbox.db
			.select()
			.from(agentSession)
			.where(eq(agentSession.id, sessionId));
		expect(session?.harnessSessionId).toBe("harness-1");
	});

	test("waits for its project, and refuses a row of another Walker or Space", async () => {
		await walkOnA("r1");
		const rows = await rowsOfA();
		await expect(b.history.ingest(rows)).rejects.toBeInstanceOf(
			MissingProjectError,
		);
		await projectOnB();
		await expect(
			b.history.ingest(rows, { walker: "someone-else" }),
		).rejects.toBeInstanceOf(ForeignRowsError);
		await expect(
			b.history.ingest(rows, { spaces: ["another-space"] }),
		).rejects.toBeInstanceOf(ForeignRowsError);
		expect(await b.history.runOwner("r1")).toBeNull();
	});

	test("gives a moved run the Walker its log names, and its new Walker finds it arriving", async () => {
		await walkOnA("r1");
		await projectOnB();
		await b.history.ingest(await rowsOfA());
		const self = a.sandbox.deviceId;
		const to = b.sandbox.deviceId;
		await a.log.append({
			type: "WalkerMoved",
			runId: "r1",
			payload: { from: self, to, by: null },
		});
		const { rows } = await a.history.rowsAfter({
			spaces: [spaceId],
			cursors: { [spaceId]: { [self]: 3 } },
		});
		await b.history.ingest(rows);
		expect(await b.history.runOwner("r1")).toEqual({ walkerId: to, spaceId });
		expect(await b.history.arriving([to])).toEqual(["r1"]);
		expect(await a.history.arriving([self])).toEqual([]);
	});
});

describe("a run's owners and files", () => {
	test("name the Walker and Space of a run and of a step", async () => {
		const { stepId } = await walkOnA("r1");
		expect(await a.history.stepOwner(stepId)).toEqual({
			runId: "r1",
			walkerId: a.sandbox.deviceId,
			spaceId,
		});
		expect(await a.history.stepOwner("nope")).toBeNull();
		expect(await a.history.runOwner("nope")).toBeNull();
		// No transcript on disk yet: no files, but the step is A's.
		expect(
			await a.history.ownStepFiles(stepId, a.sandbox.deviceId),
		).toMatchObject({ spaceId, runId: "r1", transcript: null, log: null });
		expect(await a.history.ownStepFiles(stepId, "another-walker")).toBeNull();
	});
});

describe("a Command applied", () => {
	test("is in the log from its first event", async () => {
		await walkOnA("r1");
		const command = { id: "c1", runId: "r1" };
		expect(await a.history.applied(command)).toBe(false);
		await a.history.applying(command, () =>
			a.log.append({
				type: "StopRequested",
				runId: "r1",
				payload: {},
			}),
		);
		expect(await a.history.applied(command)).toBe(true);
		expect(await a.history.applied({ id: "c2", runId: "r1" })).toBe(false);
	});
});
