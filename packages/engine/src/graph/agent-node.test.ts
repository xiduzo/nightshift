import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { Command, MemorySaver } from "@langchain/langgraph";
import type { AgentHarness, AgentSessionInput } from "@nightshift/agents";
import {
	failingScript,
	fakeHarness,
	reportingScript,
	usageLimitScript,
} from "@nightshift/agents/fake";
import {
	agentSession,
	project,
	run,
	step,
} from "@nightshift/db/schema/nightshift";
import { type Flow, type FlowInput, flowSchema } from "@nightshift/flows";
import { eq } from "drizzle-orm";

import { createRunBus } from "../bus";
import {
	deriveSteps,
	type EngineEventType,
	type EnginePayloads,
	type LoggedEvent,
} from "../events";
import { createRunLog, type RunLog } from "../run-log";
import { defaultRunSettings } from "../settings";
import { createSandbox, type Sandbox } from "../test-support";
import { readTranscriptFile } from "../transcripts";
import { compileFlow } from "./compile";
import {
	createEffectJournal,
	createRecorders,
	DEFAULT_RESUME_PROMPT,
	type StepContext,
} from "./context";
import type { Parked, RunEvent, RunStateValues } from "./state";

/**
 * The Agent node on the compiled graph, driven by the fake harness with a
 * real run log and a MemorySaver. The event log is compared with what the
 * engine writes today for the same situations (engine.test.ts,
 * foreach.test.ts "run policy").
 */

const agent = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	type: "agent" as const,
	position: { x: 0, y: 0 },
	prompt: `Work on ${id}: {{task}}`,
	harness: "claude-code" as const,
	model: "sonnet",
	permissionMode: "acceptEdits" as const,
	...extra,
});

const flowOf = (input: Omit<FlowInput, "version">): Flow =>
	flowSchema.parse({ version: 2, ...input });

const MINUTE = 1_000;

let sandbox: Sandbox;
let runs = 0;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

type Harness = {
	ctx: StepContext;
	log: RunLog;
	runId: string;
	saver: MemorySaver;
	config: { configurable: { thread_id: string } };
	/** Compiles the flow again over the same saver: a new daemon. */
	graph(): ReturnType<ReturnType<typeof compileFlow>["compile"]>;
	events(): Promise<LoggedEvent[]>;
	types(): Promise<string[]>;
};

/** A run row, its log with `RunStarted`, and a minimal StepContext. */
async function startRun(
	flow: Flow,
	harness: AgentHarness,
	options: { signal?: AbortSignal } = {},
): Promise<Harness> {
	const { db } = sandbox;
	const runId = `run-${++runs}`;
	const projectId = "project-1";
	await db
		.insert(project)
		.values({ id: projectId, name: "repo", repoPath: sandbox.repoPath })
		.onConflictDoNothing();
	await db.insert(run).values({
		id: runId,
		projectId,
		flowName: null,
		flow: JSON.stringify(flow),
		bodyFlows: "{}",
		title: "test",
		worktreePath: sandbox.repoPath,
		branch: "nightshift/test",
		baseRef: "main",
	});
	const log = createRunLog(db);
	await log.append({
		type: "RunStarted",
		runId,
		payload: {
			projectId,
			flowName: null,
			title: "test",
			start: flow.start,
			inputs: { task: "the thing" },
		},
	});
	const bus = createRunBus();
	const recorders = createRecorders({ db, bus });
	const controller = new AbortController();
	const [row] = await db.select().from(run).where(eq(run.id, runId));
	if (!row) throw new Error("no run row");
	const ctx: StepContext = {
		db,
		run: row,
		flow,
		flowName: "test",
		flows: {},
		policy: () => ({
			usageLimitFirstWaitMinutes: 5,
			usageLimitMaxWaitMinutes: 60,
			networkGraceMinutes: 240,
		}),
		log,
		bus,
		recorder: (stepId, path) => recorders.open(runId, stepId, path),
		harnessFor: (name) => (name === "claude-code" ? harness : undefined),
		mcpServersFor: async () => ({ ok: true, servers: {} }),
		effectJournal: (id, stepId) => createEffectJournal(log, id, stepId),
		signal: () => options.signal ?? controller.signal,
		now: Date.now,
		minuteMs: MINUTE,
		dataDir: sandbox.dataDir,
		settings: defaultRunSettings,
	};
	const saver = new MemorySaver();
	return {
		ctx,
		log,
		runId,
		saver,
		config: { configurable: { thread_id: runId } },
		graph: () => compileFlow(flow, ctx).compile({ checkpointer: saver }),
		events: () => log.events(runId),
		types: async () => (await log.events(runId)).map((e) => e.type),
	};
}

/** Streams the graph and collects the root's interrupts and the custom events. */
async function drive(
	h: Harness,
	input: Parameters<ReturnType<Harness["graph"]>["stream"]>[0],
	graph = h.graph(),
) {
	const parked: Parked[] = [];
	const events: RunEvent[] = [];
	const stream = await graph.stream(input, {
		...h.config,
		streamMode: ["updates", "custom"],
		subgraphs: true,
	});
	for await (const chunk of stream) {
		const [namespace, mode, data] = chunk as [string[], string, unknown];
		if (mode === "custom") {
			events.push(data as RunEvent);
			continue;
		}
		for (const [node, update] of Object.entries(
			data as Record<string, unknown>,
		)) {
			if (node !== "__interrupt__" || namespace.length > 0) continue;
			const [first] = update as { value: Parked }[];
			if (first) parked.push(first.value);
		}
	}
	const snapshot = await graph.getState(h.config);
	return {
		parked,
		events,
		state: snapshot.values as RunStateValues,
		next: [...snapshot.next],
	};
}

const payloads = <T extends EngineEventType>(
	events: LoggedEvent[],
	type: T,
): EnginePayloads[T][] =>
	events
		.filter((e) => e.type === type)
		.map((e) => e.payload as EnginePayloads[T]);

describe("the Agent node", () => {
	test("a passing step: the log, the rows, the transcript and the state are as the engine writes them", async () => {
		const harness = fakeHarness(reportingScript("pass", "Built it"));
		const h = await startRun(
			flowOf({
				inputs: [{ name: "task" }],
				start: "worker",
				nodes: [agent("worker", { skill: "tdd", effort: "high" })],
				edges: [],
			}),
			harness,
		);
		const { parked, events, state, next } = await drive(h, {
			inputs: { task: "the thing" },
		});
		expect(parked).toEqual([]);
		expect(next).toEqual([]);
		expect(harness.calls[0]).toMatchObject({
			cwd: sandbox.repoPath,
			prompt: "/tdd Work on worker: the thing",
			model: "sonnet",
			permissionMode: "acceptEdits",
			effort: "high",
			stepReport: true,
			tools: [],
		});
		expect(harness.calls[0]?.resumeSessionId).toBeUndefined();

		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
		]);
		const logged = await h.events();
		const [started] = payloads(logged, "StepStarted");
		expect(started).toMatchObject({
			nodeId: "worker",
			nodeType: "agent",
			visit: 1,
			logPath: null,
			scope: null,
		});
		expect(payloads(logged, "SessionStarted")).toEqual([
			{
				prompt: "/tdd Work on worker: the thing",
				resumeSessionId: null,
				harness: "claude-code",
			},
		]);
		expect(payloads(logged, "HarnessSessionAssigned")).toEqual([
			{ harnessSessionId: "fake-session-1", model: "fake-model" },
		]);
		expect(payloads(logged, "SessionEnded")[0]).toMatchObject({
			outcome: "finished",
			error: null,
			costUsd: null,
		});
		expect(payloads(logged, "StepEnded")).toEqual([
			{
				outcome: "pass",
				outputs: {
					outcome: "pass",
					output: "Working on it.",
					summary: "Built it",
					visit: 1,
					session_id: "fake-session-1",
				},
				error: null,
			},
		]);

		// The state carries the same outputs, the visit and the chosen end.
		const [derived] = deriveSteps(logged);
		expect(state.nodes.worker).toEqual(
			payloads(logged, "StepEnded")[0]?.outputs as Record<string, unknown>,
		);
		expect(state.visits).toEqual({ worker: 1 });
		// The log has the step list; the state does not keep it twice.
		expect(derived?.outcome).toBe("pass");
		expect("steps" in state).toBe(false);
		expect(state.pending).toBeNull();
		expect(state.ended).toEqual({
			status: "finished",
			nodeId: "worker",
			outcome: "pass",
			reason: null,
		});

		// The rows and the transcript.
		const [row] = await sandbox.db
			.select()
			.from(step)
			.where(eq(step.runId, h.runId));
		expect(row).toMatchObject({
			id: derived?.id,
			nodeId: "worker",
			nodeType: "agent",
			visit: 1,
			transcriptPath: started?.transcriptPath,
		});
		const sessions = await sandbox.db
			.select()
			.from(agentSession)
			.where(eq(agentSession.runId, h.runId));
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({
			stepId: derived?.id,
			harnessSessionId: "fake-session-1",
			prompt: "/tdd Work on worker: the thing",
		});
		expect(existsSync(started?.transcriptPath as string)).toBe(true);
		const transcript = await readTranscriptFile(
			started?.transcriptPath as string,
		);
		expect(transcript.map((e) => e.seq)).toEqual(
			transcript.map((_, i) => i + 1),
		);
		expect(transcript[0]?.event.type).toBe("session");
		expect(transcript.at(-1)?.event.type).toBe("finished");

		// The custom stream: the step, every transcript entry, the end.
		expect(events[0]).toEqual({
			type: "step-started",
			stepId: derived?.id as string,
			nodeId: "worker",
			visit: 1,
			reopened: false,
		});
		expect(events.filter((e) => e.type === "transcript")).toHaveLength(
			transcript.length,
		);
		expect(events.at(-1)).toEqual({
			type: "step-ended",
			stepId: derived?.id as string,
			nodeId: "worker",
			visit: 1,
			outcome: "pass",
		});
	});

	test("a failing step takes its retry edge until the max, then parks the run as failed", async () => {
		const harness = fakeHarness(reportingScript("fail", "Nope"));
		const h = await startRun(
			flowOf({
				start: "worker",
				nodes: [agent("worker")],
				edges: [
					{
						id: "retry",
						from: "worker",
						outcome: "fail",
						to: "worker",
						max: 2,
					},
				],
			}),
			harness,
		);
		const { parked, state, next } = await drive(h, { inputs: {} });
		expect(harness.calls).toHaveLength(3);
		expect(state.visits).toEqual({ worker: 3 });
		expect(state.traversals).toEqual({ retry: 2 });
		expect(state.ended).toBeNull();
		expect(next).toEqual(["park__worker"]);

		const logged = await h.events();
		const steps = deriveSteps(logged);
		expect(steps.map((s) => [s.visit, s.outcome])).toEqual([
			[1, "fail"],
			[2, "fail"],
			[3, "fail"],
		]);
		expect(payloads(logged, "EdgeTaken")).toEqual([
			{
				edgeId: "retry",
				from: "worker",
				to: "worker",
				outcome: "fail",
				scope: null,
			},
			{
				edgeId: "retry",
				from: "worker",
				to: "worker",
				outcome: "fail",
				scope: null,
			},
		]);
		expect(parked).toEqual([
			{
				kind: "parked",
				stepId: steps[2]?.id as string,
				nodeId: "worker",
				status: "failed",
				reason:
					'Node "worker" ended with "fail", but edge "retry" (worker → worker on fail, max 2) reached its max.',
			},
		]);
		expect(state.pending).toMatchObject({
			kind: "parked",
			stepId: steps[2]?.id,
			nodeId: "worker",
			visit: 3,
			harnessSessionId: "fake-session-3",
			prompt: null,
			status: "failed",
		});
	});

	test("an outcome without an edge parks the run as failed, with today's reason", async () => {
		const harness = fakeHarness(reportingScript("needs-input", "Which?"));
		const h = await startRun(
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			harness,
		);
		const { parked } = await drive(h, { inputs: {} });
		expect(parked[0]).toMatchObject({
			kind: "parked",
			status: "failed",
			reason:
				'Node "worker" ended with "needs-input" and no edge leaves it on that outcome.',
		});
	});

	test("a step report with a spec: own outcomes and an output schema", async () => {
		const spec = {
			outcomes: [{ name: "ship", description: "Ready" }, { name: "hold" }],
			output: {
				type: "object",
				required: ["n"],
				properties: { n: { type: "number" } },
			},
		};
		const node = () => agent("worker", spec);

		const good = fakeHarness(reportingScript("ship", "Shipped", { n: 1 }));
		const h = await startRun(
			flowOf({ start: "worker", nodes: [node()], edges: [] }),
			good,
		);
		const { state, parked } = await drive(h, { inputs: {} });
		expect(good.calls[0]?.stepReport).toEqual(spec);
		expect(parked).toEqual([]);
		// An own outcome with no edge is a chosen end, with the walk's reason.
		expect(state.ended).toEqual({
			status: "finished",
			nodeId: "worker",
			outcome: "ship",
			reason: 'Ended at node "worker" with "ship".',
		});
		expect(state.nodes.worker).toMatchObject({
			outcome: "ship",
			summary: "Shipped",
			data: { n: 1 },
		});

		const bad = fakeHarness(reportingScript("ship", "Shipped", { n: "x" }));
		const h2 = await startRun(
			flowOf({ start: "worker", nodes: [node()], edges: [] }),
			bad,
		);
		const second = await drive(h2, { inputs: {} });
		expect(second.parked[0]).toMatchObject({
			kind: "parked",
			status: "failed",
		});
		expect((second.parked[0] as { reason: string }).reason).toContain(
			"does not match the output schema",
		);
		const [ended] = payloads(await h2.events(), "StepEnded");
		expect(ended).toMatchObject({ outcome: "error" });

		const silent = fakeHarness({ steps: [], outcome: { type: "finished" } });
		const h3 = await startRun(
			flowOf({ start: "worker", nodes: [node()], edges: [] }),
			silent,
		);
		const third = await drive(h3, { inputs: {} });
		expect((third.parked[0] as { reason: string }).reason).toBe(
			'Node "worker" failed: The agent finished with no step report. This node needs one of its outcomes: ship, hold.',
		);
	});

	test("a usage limit parks the run at the wait node; a wake on a new compile over the same saver continues the same step and session", async () => {
		const resetAt = Date.now() + 60 * MINUTE;
		const harness = fakeHarness((_input: AgentSessionInput, call: number) =>
			call === 0
				? usageLimitScript(resetAt)
				: reportingScript("pass", "After the wait"),
		);
		const h = await startRun(
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			harness,
		);
		const before = Date.now();
		const first = await drive(h, { inputs: {} });
		const after = Date.now();
		expect(first.next).toEqual(["wait__worker"]);
		const [stepRow] = deriveSteps(await h.events());
		const stepId = stepRow?.id as string;
		expect(first.parked).toEqual([
			{
				kind: "wait",
				stepId,
				nodeId: "worker",
				reason: "usage-limit",
				until: resetAt + MINUTE,
				message:
					"Usage limit: You've hit your limit. The step continues a minute after the reset.",
			},
		]);
		expect(first.state.pending).toEqual({
			kind: "wait",
			stepId,
			nodeId: "worker",
			visit: 1,
			harnessSessionId: "fake-session-1",
			prompt: DEFAULT_RESUME_PROMPT,
			reason: "usage-limit",
			until: resetAt + MINUTE,
			message:
				"Usage limit: You've hit your limit. The step continues a minute after the reset.",
			resetAt,
		});
		expect(first.state.ended).toBeNull();
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"WaitStarted",
		]);
		const [wait] = payloads(await h.events(), "WaitStarted");
		expect(wait).toMatchObject({
			reason: "usage-limit",
			until: resetAt + MINUTE,
		});
		expect(wait?.since).toBeGreaterThanOrEqual(before);
		expect(wait?.since).toBeLessThanOrEqual(after);
		expect(payloads(await h.events(), "SessionEnded")[0]).toMatchObject({
			outcome: "failed",
			errorKind: "usage-limit",
			resetAt,
		});
		// The step is open in the log, and its transcript says it waits.
		expect(stepRow?.endedAt).toBeNull();
		const transcript = await readTranscriptFile(
			stepRow?.transcriptPath as string,
		);
		expect(transcript.at(-1)?.event).toEqual({
			type: "wait",
			reason: "usage-limit",
			until: resetAt + MINUTE,
			message: wait?.message as string,
		});

		// The runner's wake: WaitEnded, then the resume value on a new compile.
		await h.log.append({
			type: "WaitEnded",
			runId: h.runId,
			stepId,
			payload: { early: false },
		});
		const second = await drive(
			h,
			new Command({ resume: { kind: "wake", early: false } }),
			h.graph(),
		);
		expect(second.parked).toEqual([]);
		expect(second.state.ended?.status).toBe("finished");
		expect(second.state.pending).toBeNull();
		expect(second.state.visits).toEqual({ worker: 1 });
		expect(harness.calls).toHaveLength(2);
		expect(harness.calls[1]?.resumeSessionId).toBe("fake-session-1");
		expect(harness.calls[1]?.prompt).toBe(DEFAULT_RESUME_PROMPT);
		expect(second.events[0]).toMatchObject({
			type: "step-started",
			stepId,
			reopened: true,
		});

		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"WaitStarted",
			"WaitEnded",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
		]);
		const logged = await h.events();
		expect(payloads(logged, "SessionStarted")[1]).toEqual({
			prompt: DEFAULT_RESUME_PROMPT,
			resumeSessionId: "fake-session-1",
			harness: "claude-code",
		});
		const [worker] = deriveSteps(logged);
		expect(deriveSteps(logged)).toHaveLength(1);
		expect(worker?.outcome).toBe("pass");
		expect(worker?.sessions.map((s) => s.ending?.outcome)).toEqual([
			"failed",
			"finished",
		]);
	});

	test("a wake with a prompt passes it to the continued session", async () => {
		const harness = fakeHarness((_input: AgentSessionInput, call: number) =>
			call === 0 ? usageLimitScript() : reportingScript("pass"),
		);
		const h = await startRun(
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			harness,
		);
		const first = await drive(h, { inputs: {} });
		// No reset time: the policy's first wait.
		expect((first.parked[0] as { message: string }).message).toContain(
			"continues in 5 min",
		);
		await drive(
			h,
			new Command({
				resume: { kind: "wake", early: true, prompt: "Carry on, limit reset." },
			}),
		);
		expect(harness.calls[1]?.prompt).toBe("Carry on, limit reset.");
		expect(harness.calls[1]?.resumeSessionId).toBe("fake-session-1");
	});

	test("a stop that lands between the wake and the node's entry ends the continued step stopped, with its session; a resume reopens it", async () => {
		const harness = fakeHarness((_input: AgentSessionInput, call: number) =>
			call === 0 ? usageLimitScript() : reportingScript("pass"),
		);
		const options: { signal?: AbortSignal } = {};
		const h = await startRun(
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			harness,
			options,
		);
		const first = await drive(h, { inputs: {} });
		expect(first.next).toEqual(["wait__worker"]);
		const stepId = deriveSteps(await h.events())[0]?.id as string;

		// The runner's wake appended WaitEnded; a person pressed Stop in the
		// moment before the Agent node's entry. The step is in the log, so it
		// must end there, not stay open under a stopped run.
		await h.log.append({
			type: "WaitEnded",
			runId: h.runId,
			stepId,
			payload: { early: false },
		});
		const stopped = new AbortController();
		stopped.abort();
		options.signal = stopped.signal;
		const second = await drive(
			h,
			new Command({ resume: { kind: "wake", early: false } }),
		);
		expect(second.parked).toEqual([
			{
				kind: "parked",
				stepId,
				nodeId: "worker",
				status: "stopped",
				reason: null,
			},
		]);
		expect(second.state.pending).toMatchObject({
			kind: "parked",
			stepId,
			visit: 1,
			harnessSessionId: "fake-session-1",
		});
		// No harness call: the session was aborted as it was recorded.
		expect(harness.calls).toHaveLength(1);
		expect((await h.types()).slice(-3)).toEqual([
			"SessionStarted",
			"SessionEnded",
			"StepEnded",
		]);
		const logged = await h.events();
		expect(payloads(logged, "SessionEnded")[1]).toMatchObject({
			outcome: "stopped",
			errorKind: "aborted",
		});
		expect(payloads(logged, "StepEnded")[0]).toMatchObject({
			outcome: "stopped",
			error: null,
		});
		expect(deriveSteps(logged)).toHaveLength(1);
		expect(deriveSteps(logged)[0]?.outcome).toBe("stopped");

		// The person resumes: the same step and harness session go on.
		options.signal = new AbortController().signal;
		const third = await drive(
			h,
			new Command({ resume: { kind: "resume", prompt: "go on" } }),
		);
		expect(third.parked).toEqual([]);
		expect(third.state.ended?.status).toBe("finished");
		expect(harness.calls).toHaveLength(2);
		expect(harness.calls[1]).toMatchObject({
			prompt: "go on",
			resumeSessionId: "fake-session-1",
		});
		const after = deriveSteps(await h.events());
		expect(after).toHaveLength(1);
		expect(after[0]).toMatchObject({ id: stepId, visit: 1, outcome: "pass" });
		expect(await h.types()).toContain("StepReopened");
	});

	test("a parked failure resumed with a prompt reopens the step in a new session of the same harness session", async () => {
		const harness = fakeHarness((_input: AgentSessionInput, call: number) =>
			call === 0 ? failingScript("boom") : reportingScript("pass", "Fixed"),
		);
		const h = await startRun(
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			harness,
		);
		const first = await drive(h, { inputs: {} });
		const [stepRow] = deriveSteps(await h.events());
		const stepId = stepRow?.id as string;
		expect(first.next).toEqual(["park__worker"]);
		expect(first.parked).toEqual([
			{
				kind: "parked",
				stepId,
				nodeId: "worker",
				status: "failed",
				reason: 'Node "worker" failed: boom',
			},
		]);
		expect(payloads(await h.events(), "SessionEnded")[0]).toMatchObject({
			outcome: "failed",
			error: "boom",
			errorKind: "harness",
		});
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "error",
			error: "boom",
		});

		// The engine appends RunResumed, then resumes the thread with the prompt.
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: {
				nodeId: "worker",
				stepId,
				prompt: "Also add tests",
				scope: null,
				by: "person",
			},
		});
		const second = await drive(
			h,
			new Command({ resume: { kind: "resume", prompt: "Also add tests" } }),
		);
		expect(second.parked).toEqual([]);
		expect(second.state.ended?.status).toBe("finished");
		expect(second.state.visits).toEqual({ worker: 1 });
		expect(harness.calls).toHaveLength(2);
		expect(harness.calls[1]?.resumeSessionId).toBe("fake-session-1");
		expect(harness.calls[1]?.prompt).toBe("Also add tests");

		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
			"RunResumed",
			"StepReopened",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
		]);
		const logged = await h.events();
		expect(payloads(logged, "StepReopened")).toEqual([
			{ prompt: "Also add tests" },
		]);
		expect(logged.find((e) => e.type === "StepReopened")?.stepId).toBe(stepId);
		expect(payloads(logged, "SessionStarted")[1]).toEqual({
			prompt: "Also add tests",
			resumeSessionId: "fake-session-1",
			harness: "claude-code",
		});
		const steps = deriveSteps(logged);
		expect(steps).toHaveLength(1);
		expect(steps[0]?.outcome).toBe("pass");
		expect(steps[0]?.sessions.map((s) => s.ending?.outcome)).toEqual([
			"failed",
			"finished",
		]);
		expect(payloads(logged, "StepEnded")[1]).toMatchObject({
			outcome: "pass",
			outputs: { summary: "Fixed", session_id: "fake-session-1", visit: 1 },
		});
	});

	test("a parked step without a harness session resumes as a new visit", async () => {
		const harness = fakeHarness(reportingScript("pass"));
		const h = await startRun(
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			harness,
		);
		h.ctx.harnessFor = () => undefined;
		const first = await drive(h, { inputs: {} });
		expect(first.parked[0]).toMatchObject({
			kind: "parked",
			status: "failed",
			reason:
				'Node "worker" failed: No Claude Code harness is added. Add it under Agents.',
		});
		h.ctx.harnessFor = () => harness;
		const second = await drive(h, new Command({ resume: { kind: "resume" } }));
		expect(second.state.ended?.status).toBe("finished");
		expect(harness.calls[0]?.resumeSessionId).toBeUndefined();
		expect(deriveSteps(await h.events()).map((s) => s.visit)).toEqual([1, 2]);
		expect(await h.types()).not.toContain("StepReopened");
	});

	test("session: resume continues the node's last harness session on its next visit", async () => {
		const harness = fakeHarness((_input: AgentSessionInput, call: number) =>
			call === 0 ? reportingScript("fail") : reportingScript("pass"),
		);
		const h = await startRun(
			flowOf({
				start: "worker",
				nodes: [agent("worker", { session: "resume" })],
				edges: [
					{
						id: "again",
						from: "worker",
						outcome: "fail",
						to: "worker",
						max: 1,
					},
				],
			}),
			harness,
		);
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended?.status).toBe("finished");
		expect(
			harness.calls.map((c) => [c.prompt, c.resumeSessionId ?? null]),
		).toEqual([
			["Work on worker: ", null],
			["Work on worker: ", "fake-session-1"],
		]);
		expect(deriveSteps(await h.events()).map((s) => s.visit)).toEqual([1, 2]);
	});

	test("a stop while the session runs ends the step stopped and parks the run", async () => {
		const controller = new AbortController();
		const harness = fakeHarness({
			steps: [
				{ type: "text", text: "working" },
				{ type: "wait", ms: 10_000 },
			],
		});
		const h = await startRun(
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			harness,
			{ signal: controller.signal },
		);
		setTimeout(() => controller.abort(), 100);
		const { parked, state } = await drive(h, { inputs: {} });
		expect(parked).toEqual([
			{
				kind: "parked",
				stepId: state.pending?.stepId as string,
				nodeId: "worker",
				status: "stopped",
				reason: null,
			},
		]);
		const logged = await h.events();
		expect(payloads(logged, "SessionEnded")[0]).toMatchObject({
			outcome: "stopped",
			errorKind: "aborted",
		});
		expect(payloads(logged, "StepEnded")[0]).toMatchObject({
			outcome: "stopped",
			error: null,
		});
	});

	test("a step past its time budget ends with an error", async () => {
		const harness = fakeHarness({
			steps: [{ type: "wait", ms: 10_000 }],
		});
		const h = await startRun(
			flowOf({
				start: "worker",
				nodes: [agent("worker", { timeoutMinutes: 1 })],
				edges: [],
			}),
			harness,
		);
		h.ctx.minuteMs = 50;
		const { parked } = await drive(h, { inputs: {} });
		expect(parked[0]).toMatchObject({
			status: "failed",
			reason:
				'Node "worker" failed: The step ran past its time budget of 1 min.',
		});
	});

	test("the entry checks park the run before a step: stop after step, stop time, step cap", async () => {
		const harness = fakeHarness(reportingScript("pass"));
		const flow = flowOf({
			start: "worker",
			nodes: [agent("worker")],
			edges: [],
		});

		const stopped = await startRun(flow, harness);
		await stopped.log.append({
			type: "StopAfterStepRequested",
			runId: stopped.runId,
			payload: {},
		});
		const first = await drive(stopped, { inputs: {} });
		expect(first.parked).toEqual([
			{
				kind: "parked",
				stepId: null,
				nodeId: "worker",
				status: "stopped",
				reason: "Stopped after the running step, as asked.",
			},
		]);
		expect(await stopped.types()).not.toContain("StepStarted");
		// A resume (the engine appends RunResumed, which begins a new walk) starts the visit.
		await stopped.log.append({
			type: "RunResumed",
			runId: stopped.runId,
			payload: { nodeId: "worker", stepId: null, prompt: null, by: "person" },
		});
		const resumed = await drive(
			stopped,
			new Command({ resume: { kind: "resume" } }),
		);
		expect(resumed.state.ended?.status).toBe("finished");
		expect(deriveSteps(await stopped.events())).toHaveLength(1);

		const capped = await startRun(flow, harness);
		capped.ctx.settings = () => ({
			...defaultRunSettings(),
			maxStepsPerRun: 1,
		});
		await capped.log.append({
			type: "StepStarted",
			runId: capped.runId,
			stepId: "earlier",
			payload: {
				nodeId: "other",
				nodeType: "command",
				visit: 1,
				transcriptPath: "/dev/null",
				logPath: null,
				scope: null,
			},
		});
		const second = await drive(capped, { inputs: {} });
		expect(second.parked).toEqual([
			{
				kind: "parked",
				stepId: null,
				nodeId: "worker",
				status: "failed",
				reason:
					'The run reached the limit of 1 steps before node "worker". Resume it to continue.',
			},
		]);
	});

	test("after a daemon death, the node re-runs and continues the step the log has, with the resume's prompt", async () => {
		const harness = fakeHarness(reportingScript("pass", "Recovered"));
		const h = await startRun(
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			harness,
		);
		// The last daemon started the step and its session, then died before
		// the node committed; recovery closed both as interrupted, and the
		// engine appended RunResumed with the daemon's prompt before invoke(null).
		const stepId = "dead-step";
		await sandbox.db.insert(step).values({
			id: stepId,
			runId: h.runId,
			nodeId: "worker",
			nodeType: "agent",
			visit: 1,
			transcriptPath: `${sandbox.dataDir}/transcripts/${h.runId}/${stepId}.ndjson`,
		});
		await h.log.append({
			type: "StepStarted",
			runId: h.runId,
			stepId,
			payload: {
				nodeId: "worker",
				nodeType: "agent",
				visit: 1,
				transcriptPath: `${sandbox.dataDir}/transcripts/${h.runId}/${stepId}.ndjson`,
				logPath: null,
				scope: null,
			},
		});
		await h.log.append({
			type: "SessionStarted",
			runId: h.runId,
			stepId,
			sessionId: "dead-session",
			payload: {
				prompt: "Work on worker: ",
				resumeSessionId: null,
				harness: "claude-code",
			},
		});
		await h.log.append({
			type: "HarnessSessionAssigned",
			runId: h.runId,
			stepId,
			sessionId: "dead-session",
			payload: { harnessSessionId: "harness-0", model: null },
		});
		const interrupted = {
			error: "The daemon stopped while this ran.",
			errorKind: null,
			usage: null,
			costUsd: null,
			resetAt: null,
		};
		await h.log.append({
			type: "SessionEnded",
			runId: h.runId,
			stepId,
			sessionId: "dead-session",
			payload: { outcome: "interrupted", ...interrupted },
		});
		await h.log.append({
			type: "StepEnded",
			runId: h.runId,
			stepId,
			payload: {
				outcome: "interrupted",
				outputs: { outcome: "interrupted", visit: 1 },
				error: interrupted.error,
			},
		});
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: {
				nodeId: "worker",
				stepId,
				prompt: "The daemon stopped while you worked on this. Continue.",
				scope: null,
				by: "daemon",
				reason: "The daemon restarted.",
			},
		});

		const { state, parked } = await drive(h, { inputs: {} });
		expect(parked).toEqual([]);
		expect(state.ended?.status).toBe("finished");
		expect(state.visits).toEqual({ worker: 1 });
		expect(harness.calls).toHaveLength(1);
		expect(harness.calls[0]?.resumeSessionId).toBe("harness-0");
		expect(harness.calls[0]?.prompt).toBe(
			"The daemon stopped while you worked on this. Continue.",
		);
		const logged = await h.events();
		expect(logged.slice(-5).map((e) => e.type)).toEqual([
			"StepReopened",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
		]);
		expect(logged.find((e) => e.type === "StepReopened")?.stepId).toBe(stepId);
		expect(deriveSteps(logged)).toHaveLength(1);
		expect(deriveSteps(logged)[0]?.outcome).toBe("pass");
	});

	test("a daemon death after a wake: the step recovery ended is reopened, not continued, with the daemon's resume prompt", async () => {
		const harness = fakeHarness((_input: AgentSessionInput, call: number) =>
			call === 0 ? usageLimitScript() : reportingScript("pass", "Recovered"),
		);
		const h = await startRun(
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			harness,
		);
		await drive(h, { inputs: {} });
		const stepId = deriveSteps(await h.events())[0]?.id as string;
		await h.log.append({
			type: "WaitEnded",
			runId: h.runId,
			stepId,
			payload: { early: false },
		});

		// The wake re-entered the node, and the daemon died before the
		// session started: the checkpoint is after the wait node, the step
		// is still open in the log.
		const recorder = h.ctx.recorder;
		h.ctx.recorder = async () => {
			throw new Error("the daemon died");
		};
		await expect(
			drive(h, new Command({ resume: { kind: "wake", early: false } })),
		).rejects.toThrow("the daemon died");
		h.ctx.recorder = recorder;
		const dead = await h.graph().getState(h.config);
		expect(dead.next).toEqual(["worker"]);
		expect((dead.values as RunStateValues).pending).toMatchObject({
			kind: "wait",
			stepId,
		});
		expect(harness.calls).toHaveLength(1);

		// Recovery ended the step; the engine appended RunResumed with the
		// daemon's prompt and re-runs the node with invoke(null).
		const daemonPrompt =
			"The daemon stopped while you worked on this. Continue.";
		await h.log.append({
			type: "StepEnded",
			runId: h.runId,
			stepId,
			payload: {
				outcome: "interrupted",
				outputs: { outcome: "interrupted", visit: 1 },
				error: "The daemon stopped while this ran.",
			},
		});
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: {
				nodeId: "worker",
				stepId,
				prompt: daemonPrompt,
				scope: null,
				by: "daemon",
				reason: "The daemon restarted.",
			},
		});
		const third = await drive(h, null);
		expect(third.parked).toEqual([]);
		expect(third.state.ended?.status).toBe("finished");
		expect(third.state.visits).toEqual({ worker: 1 });
		expect(harness.calls).toHaveLength(2);
		expect(harness.calls[1]).toMatchObject({
			prompt: daemonPrompt,
			resumeSessionId: "fake-session-1",
		});
		expect(third.events[0]).toMatchObject({
			type: "step-started",
			stepId,
			reopened: true,
		});
		const logged = await h.events();
		expect(logged.slice(-5).map((e) => e.type)).toEqual([
			"StepReopened",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
		]);
		expect(payloads(logged, "StepReopened")[0]).toEqual({
			prompt: daemonPrompt,
		});
		// One step, ended once after its reopening: the read model shows pass.
		const steps = deriveSteps(logged);
		expect(steps).toHaveLength(1);
		expect(steps[0]).toMatchObject({
			id: stepId,
			visit: 1,
			outcome: "pass",
			outputs: { summary: "Recovered" },
		});
	});
});
