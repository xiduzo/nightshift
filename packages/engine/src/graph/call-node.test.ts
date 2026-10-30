import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "@langchain/langgraph";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import type { AgentSessionInput } from "@nightshift/agents/types";
import { step as stepTable } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";

import { deriveSteps } from "../read/derive-steps";
import {
	agent,
	command,
	drive,
	edge,
	flowOf,
	held,
	MINUTE,
	payloads,
	startRun,
} from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";

/**
 * The Call node (once) on the compiled graph: the called flow as a subgraph.
 * The event log is compared with what the engine writes today for the same
 * situations (flows-v2.test.ts "Call").
 */

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const greet = flowOf(
	[
		command("hello", `echo "hi {{name}} {{count}}"`),
		command("where", `echo "{{run.flow}} {{run.index}}."`),
	],
	[edge("g1", "hello", "pass", "where")],
	{
		inputs: [
			{ name: "name", type: "text", required: true },
			{ name: "count", type: "json" },
			{ name: "mood", type: "text", default: "glad" },
		],
		outputs: [
			{ name: "greeting", value: "{{hello.log_tail}}" },
			{ name: "count", value: "{{count}}" },
			{ name: "mood", value: "{{mood}}" },
		],
	},
);

const callOnce = (
	id: string,
	flow: string,
	inputs: Record<string, string> = {},
) => ({ id, type: "call", position: { x: 0, y: 0 }, flow, inputs }) as const;

describe("the Call node", () => {
	test("a called flow that passes: FlowCalled, the body in the step's scope, the declared outputs plus ended and visit", async () => {
		const h = await startRun(
			sandbox,
			flowOf(
				[
					command("prep", "printf 'x'"),
					callOnce("sub", "greet", {
						name: "{{who}}",
						count: "{{prep.exit_code}}",
					}),
					command(
						"after",
						`echo "{{sub.greeting}}|{{sub.count}}|{{sub.mood}}|{{sub.ended}}|{{sub.outcome}}"`,
					),
				],
				[edge("e1", "prep", "pass", "sub"), edge("e2", "sub", "pass", "after")],
				{ inputs: [{ name: "who", type: "text", default: "bob" }] },
			),
			{ harness: fakeHarness(), flows: { greet } },
		);
		const { parked, state, next } = await drive(h, {
			inputs: { who: "bob" },
		});
		expect(parked).toEqual([]);
		expect(next).toEqual([]);
		expect(state.ended).toEqual({
			status: "finished",
			nodeId: "after",
			outcome: "pass",
			reason: null,
		});

		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"FlowCalled",
			"StepStarted",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"StepEnded",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"StepEnded",
		]);
		const logged = await h.events();
		const steps = deriveSteps(logged);
		const sub = steps.find((s) => s.nodeId === "sub");
		expect(sub).toMatchObject({ nodeType: "call", visit: 1, scope: null });
		expect(payloads(logged, "FlowCalled")).toEqual([
			{ flow: "greet", inputs: { name: "bob", count: 0, mood: "glad" } },
		]);
		expect(sub?.outcome).toBe("pass");
		expect(sub?.outputs).toEqual({
			greeting: "hi bob 0",
			count: 0,
			mood: "glad",
			ended: "",
			outcome: "pass",
			visit: 1,
		});
		expect(sub?.error).toBeNull();
		expect(state.nodes.sub).toEqual(sub?.outputs as Record<string, unknown>);
		expect(steps.find((s) => s.nodeId === "after")?.outputs.log_tail).toBe(
			"hi bob 0|0|glad||pass",
		);

		// The body's steps and edges carry the step's scope; its run fields are the caller's.
		const scope = { parentStepId: sub?.id as string, itemId: null };
		expect(steps.find((s) => s.nodeId === "hello")?.scope).toEqual(scope);
		expect(steps.find((s) => s.nodeId === "where")?.outputs.log_tail).toBe(
			"greet .",
		);
		expect(payloads(logged, "EdgeTaken")[1]).toEqual({
			edgeId: "g1",
			from: "hello",
			to: "where",
			outcome: "pass",
			scope,
		});
		// The body's nodes are not the root's.
		expect(Object.keys(state.nodes).sort()).toEqual(["after", "prep", "sub"]);
		expect(state.visits).toEqual({ prep: 1, sub: 1, after: 1 });
		const rows = await sandbox.db
			.select()
			.from(stepTable)
			.where(eq(stepTable.runId, h.runId));
		expect(rows.map((r) => [r.nodeId, r.nodeType]).sort()).toEqual([
			["after", "command"],
			["hello", "command"],
			["prep", "command"],
			["sub", "call"],
			["where", "command"],
		]);
	});

	test("a called flow that fails makes the Subflow fail with the reason; an Agent's own outcome is `ended`", async () => {
		const broken = flowOf([command("boom", "echo broke; exit 3")], [], {
			outputs: [{ name: "why", value: "{{boom.log_tail}}" }],
		});
		const review = flowOf([
			agent("judge", "Judge it", {
				outcomes: [{ name: "approved" }, { name: "rejected" }],
			}),
		]);
		const flows = { broken, review };
		const harness = fakeHarness(reportingScript("approved", "Fine"));
		const h = await startRun(
			sandbox,
			flowOf(
				[
					callOnce("try", "broken"),
					command("cleanup", `echo "{{try.outcome}} {{try.why}}"`),
					callOnce("ask", "review"),
					command("verdict", `echo "{{ask.ended}}"`),
				],
				[
					edge("e1", "try", "fail", "cleanup"),
					edge("e2", "cleanup", "pass", "ask"),
					edge("e3", "ask", "pass", "verdict"),
				],
			),
			{ harness, flows },
		);
		const { parked, state } = await drive(h, { inputs: {} });
		expect(parked).toEqual([]);
		expect(state.ended?.nodeId).toBe("verdict");
		const logged = await h.events();
		const steps = deriveSteps(logged);
		const tried = steps.find((s) => s.nodeId === "try");
		expect(payloads(logged, "StepEnded")[1]).toEqual({
			outcome: "fail",
			outputs: { why: "broke", ended: "", outcome: "fail", visit: 1 },
			error:
				'Node "boom" ended with "fail" and no edge leaves it on that outcome.',
		});
		expect(tried?.outcome).toBe("fail");
		expect(steps.find((s) => s.nodeId === "cleanup")?.outputs.log_tail).toBe(
			"fail broke",
		);
		expect(steps.find((s) => s.nodeId === "ask")?.outputs).toEqual({
			ended: "approved",
			outcome: "pass",
			visit: 1,
		});
		expect(steps.find((s) => s.nodeId === "verdict")?.outputs.log_tail).toBe(
			"approved",
		);
		// The body's park (its step failed with no edge) never reached the root.
		expect(held(state)).toBeNull();
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"FlowCalled",
			"StepStarted",
			"StepEnded",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"FlowCalled",
			"StepStarted",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"StepEnded",
		]);

		// Without an edge on `fail`, the run parks at the Subflow node with
		// today's reason; a resume runs the Subflow again as a new visit.
		const h2 = await startRun(sandbox, flowOf([callOnce("try", "broken")]), {
			harness,
			flows,
		});
		const first = await drive(h2, { inputs: {} });
		const [tryStep] = deriveSteps(await h2.events());
		expect(first.next).toEqual(["park__try"]);
		expect(first.parked).toEqual([
			{
				kind: "parked",
				stepId: tryStep?.id as string,
				nodeId: "try",
				status: "failed",
				reason:
					'Node "try" ended with "fail" and no edge leaves it on that outcome.',
			},
		]);
		await h2.log.append({
			type: "RunResumed",
			runId: h2.runId,
			payload: { nodeId: "try", stepId: null, prompt: null, by: "person" },
		});
		const second = await drive(h2, new Command({ resume: { kind: "resume" } }));
		expect(second.parked[0]).toMatchObject({ status: "failed" });
		expect(
			deriveSteps(await h2.events())
				.filter((s) => s.nodeId === "try")
				.map((s) => [s.visit, s.outcome]),
		).toEqual([
			[1, "fail"],
			[2, "fail"],
		]);
		expect(payloads(await h2.events(), "FlowCalled")).toHaveLength(2);
		expect(await h2.types()).not.toContain("StepReopened");
	});

	test("an input binding that refuses, and a flow missing from the snapshot, are step errors", async () => {
		const needs = flowOf([command("a", "true")], [], {
			inputs: [{ name: "must", type: "text", required: true }],
		});
		const h = await startRun(
			sandbox,
			flowOf(
				[
					command("empty", "true"),
					callOnce("call", "needs", { must: "{{empty.log_tail}}" }),
				],
				[edge("e1", "empty", "pass", "call")],
			),
			{ harness: fakeHarness(), flows: { needs } },
		);
		const { parked } = await drive(h, { inputs: {} });
		expect(parked).toEqual([
			{
				kind: "parked",
				stepId: deriveSteps(await h.events())[1]?.id as string,
				nodeId: "call",
				status: "failed",
				reason: 'Node "call" failed: The flow "needs" needs a value for: must.',
			},
		]);
		expect(payloads(await h.events(), "StepEnded")[1]).toEqual({
			outcome: "error",
			outputs: { ended: "", outcome: "error", visit: 1 },
			error: 'The flow "needs" needs a value for: must.',
		});
		expect(await h.types()).not.toContain("FlowCalled");

		const h2 = await startRun(sandbox, flowOf([callOnce("call", "gone")]), {
			harness: fakeHarness(),
		});
		const second = await drive(h2, { inputs: {} });
		expect(second.parked[0]).toMatchObject({
			status: "failed",
			reason:
				'Node "call" failed: The flow "gone" is not in the run\'s snapshot.',
		});
	});

	test("a stop inside the body ends the Subflow step stopped and parks the run; a resume reopens both steps and continues the session", async () => {
		const controller = new AbortController();
		const harness = fakeHarness((_input: AgentSessionInput, call: number) => {
			if (call !== 0) return reportingScript("pass", "Finished");
			// The person stops the run while the body's session runs.
			setTimeout(() => controller.abort(), 50);
			return { steps: [{ type: "wait", ms: 10_000 }] };
		});
		const work = flowOf([agent("worker", "Work on {{topic}}")], [], {
			inputs: [{ name: "topic", type: "text" }],
			outputs: [{ name: "summary", value: "{{worker.summary}}" }],
		});
		const h = await startRun(
			sandbox,
			flowOf(
				[
					callOnce("call", "work", { topic: "trees" }),
					command("after", "true"),
				],
				[edge("e1", "call", "pass", "after")],
			),
			{ harness, flows: { work }, signal: controller.signal },
		);
		const first = await drive(h, { inputs: {} });
		const steps = deriveSteps(await h.events());
		const call = steps.find((s) => s.nodeId === "call");
		const worker = steps.find((s) => s.nodeId === "worker");
		expect(first.parked).toEqual([
			{
				kind: "parked",
				stepId: worker?.id as string,
				nodeId: "worker",
				status: "stopped",
				reason: null,
			},
		]);
		// The Subflow task never committed: the root stays at the node.
		expect(first.next).toEqual(["call"]);
		expect(held(first.state)).toBeNull();
		expect(first.state.visits).toEqual({});
		expect(await h.types()).toEqual([
			"RunStarted",
			"StepStarted",
			"FlowCalled",
			"StepStarted",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
			"StepEnded",
		]);
		const ended = payloads(await h.events(), "StepEnded");
		expect(ended[0]).toMatchObject({ outcome: "stopped", error: null });
		expect(ended[1]).toEqual({
			outcome: "stopped",
			outputs: { ended: "", outcome: "stopped", visit: 1 },
			error: null,
		});

		// The engine appends RunResumed and resumes the thread with the prompt.
		const again = new AbortController();
		h.ctx.signal = () => again.signal;
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: {
				nodeId: "worker",
				stepId: worker?.id ?? null,
				prompt: "Go on",
				scope: { parentStepId: call?.id as string, itemId: null },
				by: "person",
			},
		});
		// A stop drops the run's thread: the resume compiles it again, with
		// the new signal in the body too.
		const second = await drive(
			h,
			new Command({ resume: { kind: "resume", prompt: "Go on" } }),
			h.graph(),
		);
		expect(second.parked).toEqual([]);
		expect(second.state.ended?.nodeId).toBe("after");
		expect(harness.calls).toHaveLength(2);
		expect(harness.calls[1]?.resumeSessionId).toBe("fake-session-1");
		expect(harness.calls[1]?.prompt).toBe("Go on");
		expect((await h.types()).slice(9)).toEqual([
			"RunResumed",
			"StepReopened",
			"StepReopened",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
			"StepEnded",
			"EdgeTaken",
			"StepStarted",
			"StepEnded",
		]);
		const logged = await h.events();
		const reopened = logged.filter((e) => e.type === "StepReopened");
		expect(reopened.map((e) => [e.stepId, e.payload])).toEqual([
			[call?.id as string, { prompt: null }],
			[worker?.id as string, { prompt: "Go on", idleMs: 15 * MINUTE }],
		]);
		// One Subflow step, one FlowCalled, one body step with two sessions.
		expect(payloads(logged, "FlowCalled")).toHaveLength(1);
		const after = deriveSteps(logged);
		expect(after.filter((s) => s.nodeId === "call")).toHaveLength(1);
		expect(after.find((s) => s.nodeId === "call")?.outputs).toEqual({
			summary: "Finished",
			ended: "",
			outcome: "pass",
			visit: 1,
		});
		expect(after.find((s) => s.nodeId === "worker")?.sessions).toHaveLength(2);
		expect(second.state.visits).toEqual({ call: 1, after: 1 });
	});

	test("after a daemon death inside the body, the node re-runs, continues its step and the body resumes at its own last checkpoint", async () => {
		const harness = fakeHarness(reportingScript("pass"));
		const work = flowOf(
			[agent("first", "First"), agent("second", "Second")],
			[edge("w1", "first", "pass", "second")],
		);
		const h = await startRun(sandbox, flowOf([callOnce("call", "work")]), {
			harness,
			flows: { work },
		});
		// The daemon dies while the body's second step starts (after its
		// StepStarted, before its session).
		const recorder = h.ctx.recorder;
		let crashes = 1;
		h.ctx.recorder = async (stepId) => {
			const own = deriveSteps(await h.events()).find((s) => s.id === stepId);
			if (own?.nodeId === "second" && crashes-- > 0) {
				throw new Error("the daemon died");
			}
			return recorder(stepId);
		};
		await expect(drive(h, { inputs: {} })).rejects.toThrow("the daemon died");
		expect(harness.calls.map((c) => c.prompt)).toEqual(["First"]);
		const crashed = deriveSteps(await h.events());
		expect(crashed.map((s) => [s.nodeId, s.endedAt === null])).toEqual([
			["call", true],
			["first", false],
			["second", true],
		]);

		// Recovery closes the open steps as interrupted; the engine appends
		// RunResumed and re-runs the thread with invoke(null).
		const interrupted = (stepId: string) =>
			h.log.append({
				type: "StepEnded",
				runId: h.runId,
				stepId,
				payload: {
					outcome: "interrupted",
					outputs: { outcome: "interrupted", visit: 1 },
					error: "Night Shift stopped while this ran.",
				},
			});
		await interrupted(crashed[2]?.id as string);
		await interrupted(crashed[0]?.id as string);
		await h.log.append({
			type: "RunResumed",
			runId: h.runId,
			payload: {
				nodeId: "second",
				stepId: crashed[2]?.id ?? null,
				prompt: null,
				scope: { parentStepId: crashed[0]?.id as string, itemId: null },
				by: "daemon",
				reason: "Night Shift restarted.",
			},
		});
		const { parked, state } = await drive(h, null);
		expect(parked).toEqual([]);
		expect(state.ended?.status).toBe("finished");
		// "first" did not run again: the body went on from its checkpoint.
		expect(harness.calls.map((c) => c.prompt)).toEqual(["First", "Second"]);
		const logged = await h.events();
		expect(payloads(logged, "FlowCalled")).toHaveLength(1);
		const steps = deriveSteps(logged);
		expect(steps.map((s) => [s.nodeId, s.visit, s.outcome])).toEqual([
			["call", 1, "pass"],
			["first", 1, "pass"],
			["second", 1, "interrupted"],
			["second", 2, "pass"],
		]);
		const reopened = logged.filter((e) => e.type === "StepReopened");
		expect(reopened.map((e) => e.stepId)).toEqual([crashed[0]?.id as string]);
	});
});
