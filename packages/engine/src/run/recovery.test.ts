import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { project, run } from "@nightshift/db/schema";
import type { Flow } from "@nightshift/flows";
import {
	defaultRunSettings,
	type RunSettings,
} from "../device-config/settings";
import type { Runner } from "../graph";
import { type BusItem, createRunBus } from "../log/bus";
import type {
	EngineEventType,
	EnginePayloads,
	LoggedEvent,
	Scope,
} from "../log/events";
import { createRunLog } from "../log/run-log";
import { createSandbox, type Sandbox } from "../testing/test-support";
import {
	createRecovery,
	daemonResumeBlock,
	type ResumeBlockDeps,
} from "./recovery";

/**
 * `daemonResumeBlock`: why a daemon leaves an interrupted run to a person,
 * and what startup recovery ends a dead daemon's work with. Recovery as a
 * whole (the grace timer, the queue on a full run cap, the resume) is
 * covered by engine.test.ts through the public interface.
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
	version: 2,
	start: "a",
	nodes: [{ id: "a", type: "agent", prompt: "work" }],
	edges: [],
} as unknown as Flow;

/** One run's log, in seq order. */
function logOf(
	...items: { type: keyof EnginePayloads; payload: unknown }[]
): LoggedEvent[] {
	return items.map(
		(item, i) =>
			({
				seq: i + 1,
				runId: RUN_ID,
				stepId: null,
				sessionId: null,
				type: item.type,
				payload: item.payload,
				at: 1000 + i,
			}) as LoggedEvent,
	);
}

const started = (stopAt: number | null = null) => ({
	type: "RunStarted" as const,
	payload: { projectId: "p", flowName: "f", title: "f", start: "a", stopAt },
});
const daemonResumed = {
	type: "RunResumed" as const,
	payload: { nodeId: "a", stepId: null, prompt: null, by: "daemon" },
};
const personResumed = {
	type: "RunResumed" as const,
	payload: { nodeId: "a", stepId: null, prompt: null, by: "person" },
};

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

function deps(overrides: Partial<ResumeBlockDeps> = {}): ResumeBlockDeps {
	return {
		db: sandbox.db,
		now: () => 10_000,
		settings: () => defaultRunSettings(),
		schedulerOn: true,
		flowOf: (row) => JSON.parse(row.flow) as Flow,
		...overrides,
	};
}

describe("daemonResumeBlock", () => {
	test("lets a run continue when nothing stands in the way", async () => {
		await insertRun(sandbox.repoPath);
		expect(
			await daemonResumeBlock(RUN_ID, logOf(started()), deps()),
		).toBeNull();
	});

	test("a daemon without the scheduler never continues the night's runs", async () => {
		await insertRun(sandbox.repoPath);
		expect(
			await daemonResumeBlock(
				RUN_ID,
				logOf(started()),
				deps({ schedulerOn: false }),
			),
		).toBe("schedules are paused.");
		const paused: RunSettings = { ...defaultRunSettings(), scheduler: false };
		expect(
			await daemonResumeBlock(
				RUN_ID,
				logOf(started()),
				deps({ settings: () => paused }),
			),
		).toBe("schedules are paused.");
	});

	test("a missing run record", async () => {
		expect(await daemonResumeBlock(RUN_ID, logOf(started()), deps())).toBe(
			"the run's record is missing.",
		);
	});

	test("the flow's own policy wins over the Settings switch", async () => {
		await insertRun(sandbox.repoPath, {
			...flow,
			policy: { resumeInterruptedRuns: false },
		});
		expect(await daemonResumeBlock(RUN_ID, logOf(started()), deps())).toBe(
			"its flow turns automatic resume off.",
		);
	});

	test("automatic resume off in Settings", async () => {
		await insertRun(sandbox.repoPath);
		const off: RunSettings = {
			...defaultRunSettings(),
			resumeInterruptedRuns: false,
		};
		expect(
			await daemonResumeBlock(
				RUN_ID,
				logOf(started()),
				deps({ settings: () => off }),
			),
		).toBe("automatic resume is off in Settings.");
	});

	test("three daemon resumes in a row, with no person in between", async () => {
		await insertRun(sandbox.repoPath);
		const events = logOf(
			started(),
			daemonResumed,
			daemonResumed,
			daemonResumed,
		);
		expect(await daemonResumeBlock(RUN_ID, events, deps())).toBe(
			"it continued on its own 3 times in a row, and each time Night Shift stopped again.",
		);
		// A person's resume starts the count over.
		const withPerson = logOf(
			started(),
			daemonResumed,
			daemonResumed,
			personResumed,
			daemonResumed,
		);
		expect(await daemonResumeBlock(RUN_ID, withPerson, deps())).toBeNull();
	});

	test("a stop time that has passed", async () => {
		await insertRun(sandbox.repoPath);
		expect(await daemonResumeBlock(RUN_ID, logOf(started(9_000)), deps())).toBe(
			"its stop time has passed.",
		);
		expect(
			await daemonResumeBlock(RUN_ID, logOf(started(11_000)), deps()),
		).toBeNull();
	});

	test("a worktree that is gone", async () => {
		await insertRun(join(sandbox.root, "gone"));
		expect(await daemonResumeBlock(RUN_ID, logOf(started()), deps())).toBe(
			"the copy of the project it worked in is gone.",
		);
	});

	test("a run that waits for its worktree has none to lose", async () => {
		await insertRun("", flow, {}, "");
		expect(
			await daemonResumeBlock(RUN_ID, logOf(started()), deps()),
		).toBeNull();
	});

	test("a worktree a step made later is checked from the log", async () => {
		await insertRun("", flow, {}, "");
		const made = {
			type: "WorktreeCreated" as const,
			payload: {
				worktreePath: join(sandbox.root, "gone"),
				branch: "nightshift/b",
				baseRef: "main",
			},
		};
		expect(
			await daemonResumeBlock(RUN_ID, logOf(started(), made), deps()),
		).toBe("the copy of the project it worked in is gone.");
	});

	test("a check that throws is a reason, not a crash", async () => {
		await insertRun(sandbox.repoPath);
		expect(
			await daemonResumeBlock(
				RUN_ID,
				logOf(started()),
				deps({
					flowOf: () => {
						throw new Error("bad snapshot");
					},
				}),
			),
		).toBe("Night Shift could not check it: bad snapshot");
	});
});

describe("startup recovery: what a dead daemon's work ends with", () => {
	/** A flow with a Call once, a Call with each and a Decision, both Calls calling `inner`. */
	const outer = {
		version: 2,
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
		version: 2,
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
		const runLog = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
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

	/** Runs startup recovery on a new daemon (resume off) and returns the run's log after it. */
	async function recover(flowOf: (row: { flow: string }) => Flow) {
		const runLog = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
		const bus = createRunBus();
		told = [];
		bus.subscribe(RUN_ID, (item) => told.push(item));
		const runner = {
			take: async () => ({ kind: "unchanged" }),
			restore: () => {},
		} as unknown as Runner;
		const recovery = createRecovery({
			...deps({
				flowOf,
				settings: () => ({
					...defaultRunSettings(),
					resumeInterruptedRuns: false,
				}),
			}),
			log: runLog,
			bus,
			calledFlowsOf: (row) => JSON.parse(row.bodyFlows),
			runner,
			resumeGraceMs: 0,
		});
		await recovery.recoverInterruptedWork();
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

	test("a step of a kind from an old log, in a run whose flow cannot be read, still ends", async () => {
		await insertRun(sandbox.repoPath, "not a flow");
		await deadDaemonLog((b) => b.step("g", "approve", "gate"));
		const events = await recover((row) => JSON.parse(row.flow));
		expect(ends(events)).toEqual([
			{
				stepId: "g",
				outcome: "interrupted",
				outputs: { visit: 1, outcome: "interrupted" },
				error: "Night Shift stopped while this ran.",
			},
		]);
		expect(events.at(-1)).toMatchObject({
			type: "RunEnded",
			payload: { status: "interrupted" },
		});
	});
});
