import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "@langchain/langgraph";
import { defaultDeciderModel } from "@nightshift/agents";
import { fakeDecider } from "@nightshift/agents/testing";
import type {
	Decider,
	DecisionInput,
	DecisionResult,
} from "@nightshift/agents/types";
import { readTranscriptFile } from "../log/transcripts";
import { deriveSteps } from "../read/derive-steps";
import { command, drive, flowOf, payloads, startRun } from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";
import { DEFAULT_RESUME_PROMPT } from "./context";

/**
 * The Decision node on the compiled graph, driven by scripted deciders with
 * a real run log and a MemorySaver. The event log and the transcript are
 * compared with what the engine writes today (engine.test.ts "decisions").
 */

const decision = (
	id: string,
	labels: { name: string; description?: string }[],
	extra: Record<string, unknown> = {},
) => ({
	id,
	type: "decision" as const,
	position: { x: 0, y: 0 },
	prompt: "Go on {{task}}?",
	options: labels,
	by: "model" as const,
	decider: "typesafe" as const,
	model: "jev-1.13.0",
	...extra,
});

/** A decider the test scripts per call (0-based). */
function scriptedDecider(
	answer: (
		input: DecisionInput,
		call: number,
	) => DecisionResult | Promise<DecisionResult>,
) {
	const calls: DecisionInput[] = [];
	const decider: Decider = {
		defaultModel: defaultDeciderModel,
		async decide(input) {
			calls.push(input);
			return answer(input, calls.length - 1);
		},
	};
	return { decider, calls };
}

/** Answers with an `aborted` error when its signal fires, never before. */
const waitForAbort = (input: DecisionInput) =>
	new Promise<DecisionResult>((resolve) => {
		input.signal.addEventListener(
			"abort",
			() =>
				resolve({
					kind: "error",
					errorKind: "aborted",
					message: "aborted",
					costUsd: 0.001,
				}),
			{ once: true },
		);
	});

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("the Decision node", () => {
	test("the label is the outcome: the decider's input, the log, the transcript, the cost and the edge are as the engine writes them", async () => {
		const decider = fakeDecider([
			{ label: "ship", notes: "The tests pass.", costUsd: 0.02 },
		]);
		const h = await startRun(
			sandbox,
			flowOf({
				inputs: [{ name: "task" }],
				start: "decide",
				nodes: [
					decision("decide", [
						{ name: "ship", description: "Good enough" },
						{ name: "redo" },
					]),
					command("done", "true"),
				],
				edges: [{ id: "e1", from: "decide", outcome: "ship", to: "done" }],
			}),
			{ decider },
		);
		const { parked, state, events } = await drive(h, {
			inputs: { task: "the thing" },
		});
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("done");
		expect(decider.calls).toHaveLength(1);
		expect(decider.calls[0]).toMatchObject({
			decider: "typesafe",
			prompt: "Go on the thing?",
			labels: [{ name: "ship", description: "Good enough" }, { name: "redo" }],
			model: "jev-1.13.0",
		});

		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"StepEnded",
		]);
		const logged = await h.events();
		expect(payloads(logged, "StepStarted")[0]).toMatchObject({
			nodeId: "decide",
			nodeType: "decision",
			visit: 1,
			logPath: null,
			scope: null,
		});
		expect(payloads(logged, "StepEnded")[0]).toEqual({
			outcome: "ship",
			outputs: { outcome: "ship", note: "The tests pass.", visit: 1 },
			error: null,
			costUsd: 0.02,
			costSource: "reported",
		});
		expect(payloads(logged, "EdgeTaken")).toEqual([
			{
				edgeId: "e1",
				from: "decide",
				to: "done",
				outcome: "ship",
				scope: null,
			},
		]);
		const [decide] = deriveSteps(logged);
		expect(decide?.cost.usd).toBeCloseTo(0.02);
		expect(decide?.sessions).toEqual([]);
		const transcript = await readTranscriptFile(
			decide?.transcriptPath as string,
		);
		expect(transcript.map((e) => e.event)).toEqual([
			{
				type: "decision-start",
				prompt: "Go on the thing?",
				labels: ["ship", "redo"],
				model: "jev-1.13.0",
			},
			{ type: "decision", label: "ship", notes: "The tests pass." },
		]);
		expect(transcript.every((e) => e.sessionId === null)).toBe(true);

		expect(state.nodes.decide).toEqual({
			outcome: "ship",
			note: "The tests pass.",
			visit: 1,
		});
		expect(state.visits).toEqual({ decide: 1, done: 1 });
		expect(state.traversals).toEqual({ e1: 1 });
		expect(events.slice(0, 4).map((e) => e.type)).toEqual([
			"step-started",
			"transcript",
			"transcript",
			"step-ended",
		]);
	});

	test("a decider error fails the step with its cost, and parks the run as failed", async () => {
		const { decider } = scriptedDecider(() => ({
			kind: "error",
			errorKind: "harness",
			message: "boom",
			costUsd: 0.03,
		}));
		const h = await startRun(
			sandbox,
			flowOf({
				start: "decide",
				nodes: [
					decision("decide", [{ name: "yes" }, { name: "no" }]),
					command("done", "true"),
				],
				edges: [{ id: "e1", from: "decide", outcome: "yes", to: "done" }],
			}),
			{ decider },
		);
		const { parked, next } = await drive(h, { inputs: {} });
		const [decide] = deriveSteps(await h.events());
		expect(next).toEqual(["park__decide"]);
		expect(parked).toEqual([
			{
				kind: "parked",
				stepId: decide?.id as string,
				nodeId: "decide",
				status: "failed",
				reason: 'Node "decide" failed: The decider failed: boom',
			},
		]);
		expect(payloads(await h.events(), "StepEnded")).toEqual([
			{
				outcome: "error",
				outputs: { outcome: "error", note: "", visit: 1 },
				error: "The decider failed: boom",
				costUsd: 0.03,
				costSource: "reported",
			},
		]);
		expect(decide?.cost.usd).toBeCloseTo(0.03);
		const transcript = await readTranscriptFile(
			decide?.transcriptPath as string,
		);
		expect(transcript.map((e) => e.event.type)).toEqual(["decision-start"]);
	});

	test("a label that is not one of the node's labels is an error", async () => {
		const { decider } = scriptedDecider(() => ({
			kind: "decided",
			label: "maybe",
			notes: "Unsure.",
			costUsd: null,
		}));
		const h = await startRun(
			sandbox,
			flowOf({
				start: "decide",
				nodes: [decision("decide", [{ name: "yes" }, { name: "no" }])],
				edges: [],
			}),
			{ decider },
		);
		const { parked } = await drive(h, { inputs: {} });
		expect(parked[0]).toMatchObject({ status: "failed" });
		expect(payloads(await h.events(), "StepEnded")[0]).toEqual({
			outcome: "error",
			outputs: { outcome: "error", note: "Unsure.", visit: 1 },
			error: '"maybe" is not an option of this node. Choose one of: yes, no.',
			costUsd: null,
			costSource: null,
		});
	});

	test("without a decider the step fails with today's message", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				start: "decide",
				nodes: [decision("decide", [{ name: "yes" }, { name: "no" }])],
				edges: [],
			}),
		);
		const { parked } = await drive(h, { inputs: {} });
		expect(parked[0]).toMatchObject({
			status: "failed",
			reason:
				'Node "decide" failed: No decider is configured for Decision nodes.',
		});
		expect(payloads(await h.events(), "StepEnded")[0]).toEqual({
			outcome: "error",
			outputs: { outcome: "error", note: "", visit: 1 },
			error: "No decider is configured for Decision nodes.",
		});
	});

	test("a stop aborts the decider and ends the step stopped, with what it cost", async () => {
		const controller = new AbortController();
		const { decider, calls } = scriptedDecider(waitForAbort);
		const h = await startRun(
			sandbox,
			flowOf({
				start: "decide",
				nodes: [decision("decide", [{ name: "yes" }, { name: "no" }])],
				edges: [],
			}),
			{ decider, signal: controller.signal },
		);
		setTimeout(() => controller.abort(), 100);
		const { parked } = await drive(h, { inputs: {} });
		expect(calls[0]?.signal.aborted).toBe(true);
		expect(parked[0]).toMatchObject({ status: "stopped", reason: null });
		expect(payloads(await h.events(), "StepEnded")).toEqual([
			{
				outcome: "stopped",
				outputs: { outcome: "stopped", note: "", visit: 1 },
				error: null,
				costUsd: 0.001,
				costSource: "reported",
			},
		]);
	});

	test("a usage limit parks the run at the wait node; a wake asks again in the same step", async () => {
		const { decider, calls } = scriptedDecider((_input, call) =>
			call === 0
				? {
						kind: "error",
						errorKind: "usage-limit",
						message: "You've hit your limit.",
						costUsd: null,
					}
				: { kind: "decided", label: "yes", notes: "Now.", costUsd: 0.01 },
		);
		const h = await startRun(
			sandbox,
			flowOf({
				start: "decide",
				nodes: [decision("decide", [{ name: "yes" }, { name: "no" }])],
				edges: [],
			}),
			{ decider },
		);
		const first = await drive(h, { inputs: {} });
		const [decide] = deriveSteps(await h.events());
		const stepId = decide?.id as string;
		expect(first.next).toEqual(["wait__decide"]);
		expect(first.parked).toEqual([
			{
				kind: "wait",
				stepId,
				nodeId: "decide",
				reason: "usage-limit",
				until: expect.any(Number),
				message: expect.stringContaining("continues in 5 min"),
			},
		]);
		expect(first.state.pending).toMatchObject({
			kind: "wait",
			stepId,
			nodeId: "decide",
			visit: 1,
			session: { harnessSessionId: null, prompt: DEFAULT_RESUME_PROMPT },
			reason: "usage-limit",
		});
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"WaitStarted",
		]);
		expect(decide?.endedAt).toBeNull();

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
		expect(second.state.ended).toEqual({
			status: "finished",
			nodeId: "decide",
			outcome: "yes",
			reason: 'Ended at node "decide" with "yes".',
		});
		expect(calls).toHaveLength(2);
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"WaitStarted",
			"WaitEnded",
			"StepEnded",
		]);
		const steps = deriveSteps(await h.events());
		expect(steps).toHaveLength(1);
		expect(steps[0]).toMatchObject({ id: stepId, visit: 1, outcome: "yes" });
		expect(second.events[0]).toMatchObject({
			type: "step-started",
			stepId,
			reopened: true,
		});
		const transcript = await readTranscriptFile(
			steps[0]?.transcriptPath as string,
		);
		expect(transcript.map((e) => e.event.type)).toEqual([
			"decision-start",
			"wait",
			"decision-start",
			"decision",
		]);
		expect(transcript[1]?.event).toMatchObject({
			type: "wait",
			reason: "usage-limit",
		});
	});

	test("a daemon death after a wake: the step recovery ended is reopened, so its label and cost reach the read model", async () => {
		const { decider, calls } = scriptedDecider((_input, call) =>
			call === 0
				? {
						kind: "error",
						errorKind: "usage-limit",
						message: "You've hit your limit.",
						costUsd: null,
					}
				: { kind: "decided", label: "yes", notes: "Now.", costUsd: 0.01 },
		);
		const h = await startRun(
			sandbox,
			flowOf({
				start: "decide",
				nodes: [decision("decide", [{ name: "yes" }, { name: "no" }])],
				edges: [],
			}),
			{ decider },
		);
		await drive(h, { inputs: {} });
		const stepId = deriveSteps(await h.events())[0]?.id as string;
		await h.log.append({
			type: "WaitEnded",
			runId: h.runId,
			stepId,
			payload: { early: false },
		});

		// The wake re-entered the node, and the daemon died before the decider
		// answered: the checkpoint is after the wait node, the step is open.
		const recorder = h.ctx.recorder;
		h.ctx.recorder = async () => {
			throw new Error("the daemon died");
		};
		await expect(
			drive(h, new Command({ resume: { kind: "wake", early: false } })),
		).rejects.toThrow("the daemon died");
		h.ctx.recorder = recorder;
		const dead = await h.graph().getState(h.config);
		expect(dead.next).toEqual(["decide"]);
		expect(calls).toHaveLength(1);

		// Recovery ended the step `interrupted`; the engine appended RunResumed
		// and re-runs the node with invoke(null).
		await h.log.append({
			type: "StepEnded",
			runId: h.runId,
			stepId,
			payload: {
				outcome: "interrupted",
				outputs: { outcome: "interrupted", visit: 1, note: "" },
				error: "Night Shift stopped while this ran.",
			},
		});
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: {
				nodeId: "decide",
				stepId: null,
				prompt: null,
				scope: null,
				by: "daemon",
				reason: "Night Shift restarted.",
			},
		});
		const third = await drive(h, null);
		expect(third.parked).toEqual([]);
		expect(third.state.ended).toEqual({
			status: "finished",
			nodeId: "decide",
			outcome: "yes",
			reason: 'Ended at node "decide" with "yes".',
		});
		expect(calls).toHaveLength(2);
		expect(third.events[0]).toMatchObject({
			type: "step-started",
			stepId,
			reopened: true,
		});
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"WaitStarted",
			"WaitEnded",
			"StepEnded",
			"RunResumed",
			"StepReopened",
			"StepEnded",
		]);
		// The read model takes the end after the reopening: the label, not
		// `interrupted`, and the decider's cost.
		const steps = deriveSteps(await h.events());
		expect(steps).toHaveLength(1);
		expect(steps[0]).toMatchObject({
			id: stepId,
			visit: 1,
			outcome: "yes",
			cost: { usd: 0.01, estimated: false, missing: 0 },
		});
	});
});

/** A Decision decided by a rule: `[name, when]` per option; no `when` is the default. */
const ruled = (
	id: string,
	options: [string, string?][],
	extra: Record<string, unknown> = {},
) => ({
	id,
	type: "decision" as const,
	position: { x: 0, y: 0 },
	prompt: "",
	options: options.map(([name, when]) =>
		when === undefined ? { name } : { name, when },
	),
	by: "rule" as const,
	...extra,
});

describe("the Decision node decided by a rule", () => {
	test("the first option whose rule holds is the outcome; the step has no cost, no session and no wait node", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				inputs: [{ name: "build", type: "json" }],
				start: "check",
				nodes: [
					command("check", "exit 2"),
					ruled("pick", [
						["ship", "build.tests_passed = true and check.exit_code = 0"],
						["retry", "check.exit_code = 2 and build.tests_passed"],
						["stop"],
					]),
					command("again", "true"),
				],
				edges: [
					{ id: "e1", from: "check", outcome: "fail", to: "pick" },
					{ id: "e2", from: "pick", outcome: "retry", to: "again" },
				],
			}),
		);
		const { parked, state, events } = await drive(h, {
			inputs: { build: { tests_passed: true } },
		});
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("again");
		expect(state.nodes.pick).toEqual({ outcome: "retry", note: "", visit: 1 });
		expect(h.graph().getGraph().nodes).not.toHaveProperty("wait__pick");

		const logged = await h.events();
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"StepEnded",
		]);
		expect(payloads(logged, "StepStarted")[1]).toMatchObject({
			nodeId: "pick",
			nodeType: "decision",
			visit: 1,
		});
		expect(payloads(logged, "StepEnded")[1]).toEqual({
			outcome: "retry",
			outputs: { outcome: "retry", note: "", visit: 1 },
			error: null,
		});
		const [, pick] = deriveSteps(logged);
		expect(pick?.cost.usd).toBe(0);
		expect(pick?.sessions).toEqual([]);
		const transcript = await readTranscriptFile(pick?.transcriptPath as string);
		expect(transcript.map((e) => e.event)).toEqual([
			{
				type: "rule",
				matched: "retry",
				evaluated: [
					{ option: "ship", result: false },
					{ option: "retry", result: true },
				],
			},
		]);
		expect(
			events.filter((e) => e.type !== "transcript").map((e) => e.type),
		).toEqual([
			"step-started",
			"step-ended",
			"step-started",
			"step-ended",
			"step-started",
			"step-ended",
		]);
	});

	test("the option without a rule is the default", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				start: "pick",
				nodes: [ruled("pick", [["ship", "run.branch = 'nope'"], ["stop"]])],
				edges: [],
			}),
		);
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended).toEqual({
			status: "finished",
			nodeId: "pick",
			outcome: "stop",
			reason: 'Ended at node "pick" with "stop".',
		});
		const [pick] = deriveSteps(await h.events());
		expect(
			(await readTranscriptFile(pick?.transcriptPath as string)).map(
				(e) => e.event,
			),
		).toEqual([
			{
				type: "rule",
				matched: "stop",
				evaluated: [
					{ option: "ship", result: false },
					{ option: "stop", result: null },
				],
			},
		]);
	});

	test("no rule holds and there is no default: the step ends as error", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				start: "pick",
				nodes: [
					ruled("pick", [
						["ship", "run.branch = 'nope'"],
						["retry", "ghost.exit_code"],
					]),
				],
				edges: [],
			}),
		);
		const { parked } = await drive(h, { inputs: {} });
		expect(parked[0]).toMatchObject({
			status: "failed",
			reason:
				'Node "pick" failed: No option matched: no rule held, and no option is without a rule.',
		});
		expect(payloads(await h.events(), "StepEnded")).toEqual([
			{
				outcome: "error",
				outputs: { outcome: "error", note: "", visit: 1 },
				error:
					"No option matched: no rule held, and no option is without a rule.",
			},
		]);
		const [pick] = deriveSteps(await h.events());
		expect(
			(await readTranscriptFile(pick?.transcriptPath as string)).map(
				(e) => e.event,
			),
		).toEqual([
			{
				type: "rule",
				matched: null,
				evaluated: [
					{ option: "ship", result: false },
					{ option: "retry", result: null },
				],
			},
		]);
	});

	test("a rule that fails ends the step as error with JSONata's message", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				start: "pick",
				nodes: [ruled("pick", [["boom", "$error('no way')"], ["stop"]])],
				edges: [],
			}),
		);
		const { parked } = await drive(h, { inputs: {} });
		expect(parked[0]).toMatchObject({
			status: "failed",
			reason: 'Node "pick" failed: The rule of option "boom" failed: no way',
		});
		expect(payloads(await h.events(), "StepEnded")[0]).toMatchObject({
			outcome: "error",
			error: 'The rule of option "boom" failed: no way',
		});
	});

	test("a daemon death mid-step: the node runs a new visit on the same values, nothing is reopened", async () => {
		const h = await startRun(
			sandbox,
			flowOf({
				start: "pick",
				nodes: [ruled("pick", [["go", "$exists(run.worktree)"], ["stop"]])],
				edges: [],
			}),
		);
		const recorder = h.ctx.recorder;
		h.ctx.recorder = async () => {
			throw new Error("the daemon died");
		};
		await expect(drive(h, { inputs: {} })).rejects.toThrow("the daemon died");
		h.ctx.recorder = recorder;
		const [first] = deriveSteps(await h.events());
		expect(first).toMatchObject({ nodeId: "pick", visit: 1, endedAt: null });

		// Recovery ended the step `interrupted`; the engine appended RunResumed
		// and re-runs the node with invoke(null).
		await h.log.append({
			type: "StepEnded",
			runId: h.runId,
			stepId: first?.id as string,
			payload: {
				outcome: "interrupted",
				outputs: { outcome: "interrupted", note: "", visit: 1 },
				error: "Night Shift stopped while this ran.",
			},
		});
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: {
				nodeId: "pick",
				stepId: null,
				prompt: null,
				scope: null,
				by: "daemon",
				reason: "Night Shift restarted.",
			},
		});
		const again = await drive(h, null);
		expect(again.parked).toEqual([]);
		expect(again.state.ended).toMatchObject({ nodeId: "pick", outcome: "go" });
		expect(await h.types()).not.toContain("StepReopened");
		expect(
			deriveSteps(await h.events()).map((s) => [s.visit, s.outcome]),
		).toEqual([
			[1, "interrupted"],
			[2, "go"],
		]);
	});
});
