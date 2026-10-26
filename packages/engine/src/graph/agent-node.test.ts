import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { Command } from "@langchain/langgraph";
import {
	failingScript,
	fakeHarness,
	reportingScript,
	usageLimitScript,
} from "@nightshift/agents/testing";
import type { AgentHarness, AgentSessionInput } from "@nightshift/agents/types";
import { agentSession, step } from "@nightshift/db/schema";
import type { AgentNode } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import { readTranscriptFile } from "../log/transcripts";
import { deriveOpenGate } from "../read/derive-run";
import { deriveSteps } from "../read/derive-steps";
import {
	agent as agentNode,
	drive,
	flowOf,
	MINUTE,
	payloads,
	startRun,
} from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { DEFAULT_RESUME_PROMPT } from "./context";
import { ASK_CHOICES } from "./nodes/agent-ask";

/**
 * The Agent node on the compiled graph, driven by the fake harness with a
 * real run log and checkpoint saver: what the Agent's body makes of a session
 * (the prompt, the step report, a question to a person, the CLI tools, the sessions it
 * continues), plus one wait and one crash re-entry through the whole graph.
 * The shared rules (the entry checks, the stop time, the sleep, the resume
 * point) are tested once in step-runner.test.ts, sleep.test.ts and
 * resume-point.test.ts.
 */

const agent = (id: string, extra: Record<string, unknown> = {}) =>
	agentNode(id, `Work on ${id}: {{task}}`, extra as Partial<AgentNode>);

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("the Agent node", () => {
	test("a harness without a cost: its tokens are priced for the model it ran", async () => {
		const harness = fakeHarness({
			...reportingScript("pass"),
			model: "claude-sonnet-4-6",
			outcome: {
				type: "finished",
				usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
			},
		});
		const h = await startRun(
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			{ harness },
		);
		await drive(h, { inputs: {} });
		const logged = await h.events();
		const [ended] = payloads(logged, "SessionEnded");
		expect(ended?.costSource).toBe("estimated");
		expect(ended?.costUsd).toBeCloseTo(4.5, 6);
		expect(payloads(logged, "RunWarned")).toEqual([]);
		const cost = deriveSteps(logged)[0]?.cost;
		expect(cost?.usd).toBeCloseTo(4.5, 6);
		expect(cost).toMatchObject({ estimated: true, missing: 0 });
	});

	test("the spend so far goes to the log, not to the transcript", async () => {
		const usage = (outputTokens: number) => ({
			type: "usage" as const,
			usage: { inputTokens: 1_000_000, outputTokens },
		});
		const harness = fakeHarness({
			...reportingScript("pass"),
			model: "claude-sonnet-4-6",
			// The first usage goes out at once, the next two within 5 s: only the last of them.
			steps: [
				usage(0),
				{ type: "text", text: "Working." },
				usage(50_000),
				usage(100_000),
				...(reportingScript("pass").steps ?? []),
			],
			outcome: { type: "finished", usage: { inputTokens: 1, outputTokens: 1 } },
		});
		const h = await startRun(
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			{ harness },
		);
		await drive(h, { inputs: {} });
		const logged = await h.events();
		const spent = payloads(logged, "SessionUsage");
		expect(spent).toHaveLength(1);
		expect(spent[0]?.costSource).toBe("estimated");
		expect(spent[0]?.costUsd).toBeCloseTo(3, 6);
		// The end has the final cost, and it wins.
		const [ended] = payloads(logged, "SessionEnded");
		expect(deriveSteps(logged)[0]?.cost.usd).toBe(ended?.costUsd as number);
		const [started] = payloads(logged, "StepStarted");
		const transcript = await readTranscriptFile(
			started?.transcriptPath as string,
		);
		expect(transcript.some((e) => e.event.type === "usage")).toBe(false);
	});

	test("a session that fails keeps what it spent so far", async () => {
		const harness = fakeHarness({
			...failingScript(),
			model: "claude-sonnet-4-6",
			steps: [
				{
					type: "usage",
					usage: { inputTokens: 1_000_000, outputTokens: 100_000 },
				},
			],
		});
		const h = await startRun(
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			{ harness },
		);
		await drive(h, { inputs: {} });
		const logged = await h.events();
		const [ended] = payloads(logged, "SessionEnded");
		expect(ended?.outcome).toBe("failed");
		expect(ended?.costSource).toBe("estimated");
		expect(ended?.costUsd).toBeCloseTo(4.5, 6);
		expect(deriveSteps(logged)[0]?.cost.usd).toBeCloseTo(4.5, 6);
	});

	test("no cost and no price: the cost is missing, and the run warns about it", async () => {
		const harness = fakeHarness({
			...reportingScript("pass"),
			model: "a-model-without-a-price",
			outcome: {
				type: "finished",
				usage: { inputTokens: 1_000, outputTokens: 100 },
			},
		});
		const h = await startRun(
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			{ harness },
		);
		const { parked } = await drive(h, { inputs: {} });
		// A warning, not a failure: the step passes.
		expect(parked).toEqual([]);
		const logged = await h.events();
		expect(payloads(logged, "SessionEnded")[0]).toMatchObject({
			costUsd: null,
			costSource: null,
		});
		expect(payloads(logged, "RunWarned")).toEqual([
			{
				kind: "cost-unknown",
				message:
					'The cost of this step is not known. Claude Code reported no cost, and Night Shift has no price for "a-model-without-a-price". Spend totals leave it out.',
			},
		]);
		expect(deriveSteps(logged)[0]?.cost).toEqual({
			usd: 0,
			estimated: false,
			missing: 1,
			calls: 1,
		});
	});

	test("a passing step: the log, the rows, the transcript and the state are as the engine writes them", async () => {
		const harness = fakeHarness(reportingScript("pass", "Built it"));
		const h = await startRun(
			sandbox,
			flowOf({
				inputs: [{ name: "task" }],
				start: "worker",
				nodes: [agent("worker", { skill: "tdd", effort: "high" })],
				edges: [],
			}),
			{ harness },
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
			costUsd: 0.001,
			costSource: "reported",
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
			sandbox,
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
			{ harness },
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
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			{ harness },
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
			sandbox,
			flowOf({ start: "worker", nodes: [node()], edges: [] }),
			{ harness: good },
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
			sandbox,
			flowOf({ start: "worker", nodes: [node()], edges: [] }),
			{ harness: bad },
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

		// The object sent as JSON text counts as the object.
		const asText = fakeHarness(
			reportingScript("ship", "Shipped", JSON.stringify({ n: 2 })),
		);
		const h4 = await startRun(
			sandbox,
			flowOf({ start: "worker", nodes: [node()], edges: [] }),
			{ harness: asText },
		);
		const fourth = await drive(h4, { inputs: {} });
		expect(fourth.parked).toEqual([]);
		expect(fourth.state.nodes.worker).toMatchObject({ data: { n: 2 } });

		const silent = fakeHarness({ steps: [], outcome: { type: "finished" } });
		const h3 = await startRun(
			sandbox,
			flowOf({ start: "worker", nodes: [node()], edges: [] }),
			{ harness: silent },
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
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			{ harness },
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
			reason: "usage-limit",
			until: resetAt + MINUTE,
			message:
				"Usage limit: You've hit your limit. The step continues a minute after the reset.",
			streak: { count: 1, since: expect.any(Number) },
			session: {
				harnessSessionId: "fake-session-1",
				prompt: DEFAULT_RESUME_PROMPT,
			},
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

	test("a new session learns its CLI tools after the prompt; the log and a continued session do not", async () => {
		const harness = fakeHarness((_input: AgentSessionInput, call: number) =>
			call === 0 ? usageLimitScript() : reportingScript("pass"),
		);
		const h = await startRun(
			sandbox,
			flowOf({
				start: "worker",
				nodes: [agent("worker", { clis: ["acli"] })],
				edges: [],
			}),
			{ harness },
		);
		const asked: string[][] = [];
		h.local.cliToolsFor = async (names) => {
			asked.push([...names]);
			return names.map((name) => ({
				name,
				description: "Jira issues",
				help: "Usage: acli <command>",
			}));
		};
		await drive(h, { inputs: {} });
		expect(asked).toEqual([["acli"]]);
		const first = harness.calls[0]?.prompt ?? "";
		expect(first.startsWith("Work on worker: \n\n## CLI tools")).toBe(true);
		expect(first).toContain("### acli\n\nJira issues");
		expect(first).toContain("```text\nUsage: acli <command>\n```");
		expect(
			payloads(await h.events(), "SessionStarted").map((p) => p.prompt),
		).toEqual(["Work on worker: "]);

		await drive(
			h,
			new Command({ resume: { kind: "wake", early: true, prompt: "Go on." } }),
		);
		expect(harness.calls[1]?.prompt).toBe("Go on.");
		expect(asked).toHaveLength(1);
	});

	test("plan mode runs no command: the session gets no CLI tools", async () => {
		const harness = fakeHarness(() => reportingScript("pass"));
		const h = await startRun(
			sandbox,
			flowOf({
				start: "worker",
				nodes: [agent("worker", { clis: ["acli"], permissionMode: "plan" })],
				edges: [],
			}),
			{ harness },
		);
		h.local.cliToolsFor = async () => {
			throw new Error("not asked in plan mode");
		};
		await drive(h, { inputs: {} });
		expect(harness.calls[0]?.prompt).toBe("Work on worker: ");
	});

	test("a stop that lands between the wake and the node's entry ends the continued step stopped, with its session; a resume reopens it", async () => {
		const harness = fakeHarness((_input: AgentSessionInput, call: number) =>
			call === 0 ? usageLimitScript() : reportingScript("pass"),
		);
		const options: { harness: AgentHarness; signal?: AbortSignal } = {
			harness,
		};
		const h = await startRun(
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
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
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			{ harness },
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
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			{ harness },
		);
		h.local.harnesses = {};
		const first = await drive(h, { inputs: {} });
		expect(first.parked[0]).toMatchObject({
			kind: "parked",
			status: "failed",
			reason:
				'Node "worker" failed: No Claude Code harness is added. Add it under Agents.',
		});
		h.local.harnesses = { "claude-code": harness };
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
			sandbox,
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
			{ harness },
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
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			{ harness, signal: controller.signal },
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

	test("after a daemon death, the node re-runs and continues the step the log has, with the resume's prompt", async () => {
		const harness = fakeHarness(reportingScript("pass", "Recovered"));
		const h = await startRun(
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			{ harness },
		);
		// The last daemon started the step and its session, then died before
		// the node committed; recovery closed both as interrupted, and the
		// engine appended RunResumed with the daemon's prompt before invoke(null).
		const stepId = "dead-step";
		await sandbox.db.insert(step).values({
			id: stepId,
			spaceId: sandbox.spaceId,
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
			error: "Night Shift stopped while this ran.",
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
				prompt: "Night Shift stopped while you worked on this. Continue.",
				scope: null,
				by: "daemon",
				reason: "Night Shift restarted.",
			},
		});

		const { state, parked } = await drive(h, { inputs: {} });
		expect(parked).toEqual([]);
		expect(state.ended?.status).toBe("finished");
		expect(state.visits).toEqual({ worker: 1 });
		expect(harness.calls).toHaveLength(1);
		expect(harness.calls[0]?.resumeSessionId).toBe("harness-0");
		expect(harness.calls[0]?.prompt).toBe(
			"Night Shift stopped while you worked on this. Continue.",
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
});

describe("an Agent that asks a person", () => {
	/** Asks first, then passes with the answer. */
	const asking = () =>
		fakeHarness((_input, call) =>
			call === 0
				? reportingScript("needs-input", "Which database should I use?")
				: reportingScript("pass", "Built it on Postgres."),
		);
	const askFlow = (extra: Record<string, unknown> = {}) =>
		flowOf({
			start: "worker",
			nodes: [agent("worker", { ask: "person", ...extra })],
			edges: [],
		});

	test("needs-input opens a Gate on the open step; the answer reopens it and the session goes on with the note", async () => {
		const harness = asking();
		const h = await startRun(sandbox, askFlow(), { harness });
		const first = await drive(h, { inputs: { task: "x" } });
		const [own] = deriveSteps(await h.events());
		const stepId = own?.id as string;
		const question = "Which database should I use?\n\nWorking on it.";
		expect(first.next).toEqual(["ask__worker"]);
		expect(first.parked).toEqual([
			{
				kind: "gate",
				stepId,
				nodeId: "worker",
				question,
				choices: [...ASK_CHOICES],
			},
		]);
		// The agent may report needs-input, and learns where its questions go.
		expect(harness.calls[0]?.stepReport).toEqual({
			outcomes: [
				{ name: "pass", description: "The task is done." },
				{ name: "fail", description: "The task is not done." },
				{
					name: "needs-input",
					description:
						"You need a person to answer before you can go on. Put your questions in your final message.",
				},
			],
		});
		const asked = await h.events();
		expect(own).toMatchObject({ endedAt: null, outcome: null });
		expect(payloads(asked, "GateOpened")).toEqual([
			{ question, choices: [...ASK_CHOICES] },
		]);
		expect(deriveOpenGate(asked)).toMatchObject({ stepId, nodeId: "worker" });
		expect(payloads(asked, "StepEnded")).toEqual([]);

		const second = await drive(
			h,
			new Command({
				resume: { kind: "gate", choice: "answer", note: "Use Postgres." },
			}),
			h.graph(),
		);
		expect(second.parked).toEqual([]);
		expect(second.state.ended?.nodeId).toBe("worker");
		expect(harness.calls[1]).toMatchObject({
			prompt: "Use Postgres.",
			resumeSessionId: "fake-session-1",
		});
		const after = await h.events();
		expect(deriveSteps(after)).toHaveLength(1);
		expect(payloads(after, "StepReopened")).toEqual([
			{ prompt: "Use Postgres." },
		]);
		expect(deriveOpenGate(after)).toBeNull();
		expect(payloads(after, "StepEnded")).toEqual([
			{
				outcome: "pass",
				outputs: expect.objectContaining({
					outcome: "pass",
					summary: "Built it on Postgres.",
					note: "Use Postgres.",
				}),
				error: null,
			},
		]);
		const transcript = await readTranscriptFile(own?.transcriptPath as string);
		expect(
			transcript
				.map((e) => e.event)
				.filter((e) => e.type === "gate-open" || e.type === "gate-resolved"),
		).toEqual([
			{ type: "gate-open", question, choices: [...ASK_CHOICES] },
			{ type: "gate-resolved", choice: "answer", note: "Use Postgres." },
		]);
	});

	test("stop ends the step fail with what the agent said and the note", async () => {
		const harness = asking();
		const h = await startRun(sandbox, askFlow(), { harness });
		await drive(h, { inputs: { task: "x" } });
		const second = await drive(
			h,
			new Command({
				resume: { kind: "gate", choice: "stop", note: "Not now." },
			}),
			h.graph(),
		);
		expect(harness.calls).toHaveLength(1);
		expect(second.parked[0]).toMatchObject({
			kind: "parked",
			status: "failed",
		});
		expect(payloads(await h.events(), "StepEnded")).toEqual([
			{
				outcome: "fail",
				outputs: expect.objectContaining({
					outcome: "fail",
					summary: "Which database should I use?",
					note: "Not now.",
				}),
				error: null,
			},
		]);
	});

	test("with own outcomes the agent may report needs-input too", async () => {
		const harness = asking();
		const h = await startRun(
			sandbox,
			askFlow({ outcomes: [{ name: "built" }, { name: "needs-input" }] }),
			{ harness },
		);
		const first = await drive(h, { inputs: { task: "x" } });
		expect(first.next).toEqual(["ask__worker"]);
		expect(harness.calls[0]?.stepReport).toEqual({
			outcomes: [
				{ name: "built" },
				{
					name: "needs-input",
					description:
						"You need a person to answer before you can go on. Put your questions in your final message.",
				},
			],
		});
	});

	test("a person resumes a run stopped at the Gate: the session goes on with the resume's prompt", async () => {
		const harness = asking();
		const h = await startRun(sandbox, askFlow(), { harness });
		await drive(h, { inputs: { task: "x" } });
		const [own] = deriveSteps(await h.events());
		const stepId = own?.id as string;
		// What the runner and the engine append for a stop and a resume.
		await h.log.append({ type: "StopRequested", runId: h.runId, payload: {} });
		await h.log.append({
			type: "StepEnded",
			runId: h.runId,
			stepId,
			payload: {
				outcome: "stopped",
				outputs: { outcome: "stopped", visit: 1 },
				error: null,
			},
		});
		await h.log.append({
			type: "RunEnded",
			runId: h.runId,
			payload: { status: "stopped", reason: null },
		});
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: {
				nodeId: "worker",
				stepId,
				prompt: "Pick one yourself.",
				by: "person",
			},
		});
		const second = await drive(
			h,
			new Command({ resume: { kind: "reopen" } }),
			h.graph(),
		);
		expect(second.state.ended?.nodeId).toBe("worker");
		expect(harness.calls[1]).toMatchObject({
			prompt: "Pick one yourself.",
			resumeSessionId: "fake-session-1",
		});
		expect(payloads(await h.events(), "StepReopened")).toEqual([
			{ prompt: "Pick one yourself." },
		]);
	});
});
