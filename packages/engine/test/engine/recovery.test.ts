import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { project, run } from "@nightshift/db/schema";
import { FLOW_VERSION, type Flow } from "@nightshift/flows";
import type {
	EngineEventType,
	EnginePayloads,
	LoggedEvent,
} from "../../src/log/events/events";
import type { Scope } from "../../src/log/events/step/step-payloads";
import { createRunLog } from "../../src/log/run-log/run-log";
import { type BusItem, createRunBus } from "../../src/log/transcript/bus";
import { wireRecovery } from "../../src/runs";
import type { Turns } from "../../src/runs/walk";
import { defaultRunSettings } from "../../src/settings/settings";
import { createSandbox, type Sandbox } from "../../src/testing/test-support";

/**
 * What startup recovery ends a dead daemon's work with, on a real run log
 * over a sandbox. Why a daemon leaves an interrupted run to a person is
 * the rule of `runs/recovery/domain/resume-block.ts`, tested beside it.
 * Recovery as a whole (the grace timer, the queue on a full run cap, the
 * resume) is covered by engine.test.ts through the public interface.
 */

let sandbox: Sandbox;

beforeEach(async () => {
	sandbox = await createSandbox();
});

afterEach(async () => {
	await sandbox.cleanup();
});

const RUN_ID = "run-1";
const flow: Flow = {
	version: FLOW_VERSION,
	start: "a",
	nodes: [{ id: "a", type: "agent", prompt: "work" }],
	edges: [],
} as unknown as Flow;

const started = (stopAt: number | null = null) => ({
	type: "RunStarted" as const,
	payload: { projectId: "p", flowName: "f", title: "f", start: "a", stopAt },
});

/** A run row whose worktree is `worktreePath` and whose flow is `ownFlow` (a string: the snapshot as stored). */
async function insertRun(
	worktreePath: string,
	ownFlow: Flow | string = flow,
	bodyFlows: Record<string, Flow> = {},
	branch = "b",
) {
	await sandbox.db
		.insert(project)
		.values({ id: "p", spaceId: sandbox.spaceId, name: "p" })
		.onConflictDoNothing();
	await sandbox.db.insert(run).values({
		id: RUN_ID,
		spaceId: sandbox.spaceId,
		projectId: "p",
		flowName: "f",
		flow: typeof ownFlow === "string" ? ownFlow : JSON.stringify(ownFlow),
		bodyFlows: JSON.stringify(bodyFlows),
		title: "f",
		worktreePath,
		branch,
		baseRef: "main",
		walkerId: sandbox.deviceId,
	});
}

describe("startup recovery: what a dead daemon's work ends with", () => {
	/** A flow with a Call once, a Call with each and a Decision, both Calls calling `inner`. */
	const outer = {
		version: FLOW_VERSION,
		start: "once",
		nodes: [
			{ id: "once", type: "call", flow: "inner" },
			{
				id: "loop",
				type: "call",
				flow: "inner",
				each: { source: { kind: "json", value: "[]" } },
			},
			{ id: "d", type: "decision", by: "model", options: [] },
		],
		edges: [],
	} as unknown as Flow;
	const inner = {
		version: FLOW_VERSION,
		start: "w",
		nodes: [{ id: "w", type: "agent", prompt: "work" }],
		edges: [],
	} as unknown as Flow;

	/** Appends the dead daemon's log through a real run log, as its own Walker. */
	async function deadDaemonLog(
		build: (b: {
			push<T extends EngineEventType>(
				type: T,
				payload: EnginePayloads[T],
				ids?: { stepId?: string; sessionId?: string },
			): Promise<void>;
			step(
				stepId: string,
				nodeId: string,
				nodeType: string,
				scope?: Scope | null,
			): Promise<void>;
		}) => Promise<void>,
	) {
		const runLog = createRunLog(sandbox.db, {
			walkerId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
		});
		const push = async <T extends EngineEventType>(
			type: T,
			payload: EnginePayloads[T],
			ids: { stepId?: string; sessionId?: string } = {},
		) => {
			await runLog.append({ type, payload, runId: RUN_ID, ...ids });
		};
		await push("RunStarted", started().payload as EnginePayloads["RunStarted"]);
		await build({
			push,
			step: (stepId, nodeId, nodeType, scope = null) =>
				push(
					"StepStarted",
					{
						nodeId,
						nodeType: nodeType as EnginePayloads["StepStarted"]["nodeType"],
						visit: 1,
						transcriptPath: `/t/${stepId}`,
						logPath: null,
						scope,
					},
					{ stepId },
				),
		});
	}

	/** What recovery told the bus about the run. */
	let told: BusItem[] = [];
	/** What recovery told the run's holds (leases): each end and each run that does not continue. */
	let holdsHeard: string[] = [];

	/** Runs startup recovery on a new daemon (resume off) and returns the run's log after it. */
	async function recover(flowOf: (row: { flow: string }) => Flow) {
		const runLog = createRunLog(sandbox.db, {
			walkerId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
		});
		const bus = createRunBus();
		told = [];
		holdsHeard = [];
		bus.subscribe(RUN_ID, (item) => told.push(item));
		const turns = {
			take: async () => ({ kind: "unchanged" }),
			restore: () => {},
		} as unknown as Turns;
		const recovery = wireRecovery({
			openWork: {
				db: sandbox.db,
				log: runLog,
				bus,
				flowOf,
				calledFlowsOf: (row) => JSON.parse(row.bodyFlows),
				runHolds: {
					ended: async (runId, status) => {
						holdsHeard.push(`${runId} ended ${status}`);
					},
					notContinuing: async (runId) => {
						holdsHeard.push(`${runId} does not continue`);
					},
					resuming: async () => {},
				},
			},
			waits: { db: sandbox.db, log: runLog },
			facts: runLog,
			turns,
			holds: { start: (_spaceId, work) => work() },
			openRun: async (_actor, { runId }) => ({
				run: await runLog.row(runId),
				walkedHere: true,
			}),
			now: () => 10_000,
			settings: () => ({
				...defaultRunSettings(),
				resumeInterruptedRuns: false,
			}),
			schedulerOn: true,
			resumeGraceMs: 0,
		});
		await recovery.recoverRuns();
		return runLog.events(RUN_ID);
	}

	const ends = (events: readonly LoggedEvent[]) =>
		events.flatMap((e) =>
			e.type === "StepEnded" ? [{ stepId: e.stepId, ...e.payload }] : [],
		);

	test("a Call and the step inside it end from the inside out, with the Call's outputs", async () => {
		await insertRun(sandbox.repoPath, outer, { inner });
		await deadDaemonLog(async (b) => {
			await b.step("c", "once", "call");
			await b.step("w", "w", "agent", { parentStepId: "c", itemId: null });
		});
		const events = await recover((row) => JSON.parse(row.flow));
		const error = "Night Shift stopped while this ran.";
		expect(ends(events)).toEqual([
			{
				stepId: "w",
				outcome: "interrupted",
				outputs: { visit: 1, outcome: "interrupted" },
				error,
			},
			{
				stepId: "c",
				outcome: "interrupted",
				outputs: { outcome: "interrupted", ended: "", visit: 1 },
				error,
			},
		]);
		expect(events.at(-1)).toMatchObject({
			type: "RunEnded",
			payload: { status: "interrupted" },
		});
		expect(told).toEqual([
			{ kind: "step-changed", stepId: "w" },
			{ kind: "step-changed", stepId: "c" },
			{ kind: "status-changed" },
		]);
	});

	test("given an interrupted run that does not continue on its own, then it lets go of what it holds", async () => {
		await insertRun(sandbox.repoPath, outer, { inner });
		await deadDaemonLog(async (b) => {
			await b.step("c", "once", "call");
		});
		await recover((row) => JSON.parse(row.flow));
		expect(holdsHeard).toEqual([
			`${RUN_ID} ended interrupted`,
			`${RUN_ID} does not continue`,
		]);
	});

	test("a Call with each counts its items, from the whole log", async () => {
		await insertRun(sandbox.repoPath, outer, { inner });
		await deadDaemonLog(async (b) => {
			await b.step("c", "loop", "call");
			for (const [id, index] of [
				["i1", 1],
				["i2", 2],
			] as const) {
				await b.push(
					"ItemStarted",
					{
						item: { id, title: id, url: null, value: id },
						index,
						branch: null,
						baseBranch: null,
					},
					{ stepId: "c" },
				);
				if (id === "i1") {
					await b.push(
						"ItemEnded",
						{ itemId: id, state: "done", reason: null },
						{ stepId: "c" },
					);
				}
			}
			await b.step("w", "w", "agent", { parentStepId: "c", itemId: "i2" });
		});
		const events = await recover((row) => JSON.parse(row.flow));
		expect(ends(events).find((e) => e.stepId === "c")?.outputs).toMatchObject({
			outcome: "interrupted",
			done_count: 1,
			failed_count: 0,
			results: [
				{ id: "i1", state: "done" },
				{ id: "i2", state: "running" },
			],
		});
	});

	test("a Decision it interrupts ends with an empty note", async () => {
		await insertRun(sandbox.repoPath, outer, { inner });
		await deadDaemonLog((b) => b.step("d1", "d", "decision"));
		const events = await recover((row) => JSON.parse(row.flow));
		expect(ends(events)[0]?.outputs).toEqual({
			outcome: "interrupted",
			note: "",
			visit: 1,
		});
	});

	test("a step of a kind this build does not know, in a run whose flow cannot be read, still ends", async () => {
		await insertRun(sandbox.repoPath, "not a flow");
		await deadDaemonLog((b) => b.step("g", "approve", "gate"));
		const events = await recover((row) => JSON.parse(row.flow));
		expect(ends(events)).toEqual([
			{
				stepId: "g",
				outcome: "interrupted",
				outputs: { ended: "", visit: 1, outcome: "interrupted" },
				error: "Night Shift stopped while this ran.",
			},
		]);
		expect(events.at(-1)).toMatchObject({
			type: "RunEnded",
			payload: { status: "interrupted" },
		});
	});
});
