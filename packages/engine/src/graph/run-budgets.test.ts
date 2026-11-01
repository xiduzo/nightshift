import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import type { AgentNode, Policy } from "@nightshift/flows";
import { now } from "@nightshift/time";
import {
	agent as agentNode,
	drive,
	edge,
	flowOf,
	MINUTE,
	payloads,
	startRun,
} from "../testing/graph";
import { createSandbox, type Sandbox } from "../testing/test-support";

/**
 * The guards of the run policy on the compiled graph, with the fake
 * harness and the test clock (one minute is `MINUTE` ms): the run budget,
 * the turn limit (on Claude Code's command line, and counted by the engine
 * for other harnesses), the stall guard's default, and the loop guard.
 */

/** One step of a fake session's script. */
type FakeStep = NonNullable<
	NonNullable<Parameters<typeof fakeHarness>[0]> extends infer S
		? S extends { steps?: infer T }
			? T
			: never
		: never
>[number];

const agent = (id: string, extra: Partial<AgentNode> = {}) =>
	agentNode(id, `Work on ${id}`, extra);

const withPolicy = (
	nodes: AgentNode[],
	policy: Policy,
	edges: ReturnType<typeof edge>[] = [],
) => ({
	...flowOf({ start: nodes[0]?.id ?? "", nodes, edges }),
	policy,
});

/** What a model call spends: a million input tokens of Sonnet are $3. */
const spent = (inputTokens: number): FakeStep => ({
	type: "usage",
	usage: { inputTokens, outputTokens: 0 },
});

const call = (name: string, input: unknown): FakeStep => ({
	type: "tool",
	name,
	input,
	result: "ok",
});

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

describe("the run budget", () => {
	test("the spend so far past the budget stops the session and the run, failed, with a budget warning", async () => {
		const harness = fakeHarness({
			model: "claude-sonnet-4-6",
			steps: [
				{ type: "text", text: "Working." },
				spent(1_000_000),
				{ type: "wait", ms: 30_000 },
			],
		});
		const h = await startRun(
			sandbox,
			withPolicy([agent("worker")], { budgetUsd: 1 }),
			{ harness },
		);
		const started = now();
		const { parked } = await drive(h, { inputs: {} });
		expect(now() - started).toBeLessThan(10_000);
		const reason =
			"The run spent $3.00 of its $1.00 budget, so it stopped. Resume it to spend up to $1.00 more.";
		expect(parked[0]).toMatchObject({
			kind: "parked",
			nodeId: "worker",
			status: "failed",
			reason,
		});
		const logged = await h.events();
		expect(payloads(logged, "SessionEnded")[0]).toMatchObject({
			outcome: "failed",
			errorKind: "aborted",
		});
		// The step stopped with its session: a resume reopens it.
		expect(payloads(logged, "StepEnded")[0]).toMatchObject({
			outcome: "stopped",
			error: reason,
		});
		expect(payloads(logged, "RunWarned")).toEqual([
			{ kind: "budget", message: reason },
		]);
		// What was left of the budget went to the harness.
		expect(harness.calls[0]?.maxBudgetUsd).toBe(1);
	});

	test("a step that took the run past its budget ends; the next step does not start", async () => {
		const harness = fakeHarness({
			...reportingScript("pass"),
			model: "claude-sonnet-4-6",
			outcome: {
				type: "finished",
				usage: { inputTokens: 1_000_000, outputTokens: 0 },
			},
		});
		const h = await startRun(
			sandbox,
			withPolicy([agent("first"), agent("second")], { budgetUsd: 2 }, [
				edge("e1", "first", "pass", "second"),
			]),
			{ harness },
		);
		const { parked } = await drive(h, { inputs: {} });
		const reason =
			'The run spent $3.00 of its $2.00 budget, so it stopped before node "second". Resume it to spend up to $2.00 more.';
		expect(parked[0]).toMatchObject({ status: "failed", reason });
		const logged = await h.events();
		expect(payloads(logged, "StepStarted").map((p) => p.nodeId)).toEqual([
			"first",
		]);
		expect(payloads(logged, "RunWarned")).toEqual([
			{ kind: "budget", message: reason },
		]);
		expect(harness.calls).toHaveLength(1);
	});

	test("Claude Code stopping at the budget it was given stops the run the same way", async () => {
		const harness = fakeHarness({
			model: "claude-sonnet-4-6",
			outcome: {
				type: "finished",
				limit: "budget",
				usage: { inputTokens: 500_000, outputTokens: 0, costUsd: 1.5 },
			},
		});
		const h = await startRun(
			sandbox,
			withPolicy([agent("worker")], { budgetUsd: 1.5 }),
			{ harness },
		);
		const { parked } = await drive(h, { inputs: {} });
		expect(parked[0]).toMatchObject({
			status: "failed",
			reason:
				"The run spent $1.50 of its $1.50 budget, so it stopped. Resume it to spend up to $1.50 more.",
		});
		expect(payloads(await h.events(), "RunWarned")[0]?.kind).toBe("budget");
	});

	test("without a budget nothing stops and the harness gets no budget", async () => {
		const harness = fakeHarness({
			...reportingScript("pass"),
			model: "claude-sonnet-4-6",
			steps: [spent(10_000_000), ...(reportingScript("pass").steps ?? [])],
		});
		const h = await startRun(
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			{ harness },
		);
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended?.status).toBe("finished");
		expect(harness.calls[0]?.maxBudgetUsd).toBeUndefined();
		expect(payloads(await h.events(), "RunWarned")).toEqual([]);
	});
});

describe("the turn limit", () => {
	test("goes to Claude Code on the command line: the node's own, else the policy's", async () => {
		const harness = fakeHarness(reportingScript("pass"));
		const h = await startRun(
			sandbox,
			withPolicy(
				[agent("own", { maxTurns: 7 }), agent("policy")],
				{ maxTurns: 9 },
				[edge("e1", "own", "pass", "policy")],
			),
			{ harness },
		);
		await drive(h, { inputs: {} });
		expect(harness.calls.map((c) => c.maxTurns)).toEqual([7, 9]);
	});

	test("Claude Code stopping at its turn limit ends the step fail, with a budget warning", async () => {
		const harness = fakeHarness({
			steps: [{ type: "text", text: "Still working." }],
			outcome: { type: "finished", limit: "turns" },
		});
		const h = await startRun(
			sandbox,
			flowOf({
				start: "worker",
				nodes: [agent("worker", { maxTurns: 4 }), agent("fixer")],
				edges: [edge("e1", "worker", "fail", "fixer")],
			}),
			{ harness },
		);
		await drive(h, { inputs: {} });
		const logged = await h.events();
		const message =
			"The agent reached its limit of 4 turns, so the step stopped.";
		expect(payloads(logged, "StepEnded")[0]).toMatchObject({
			outcome: "fail",
			error: message,
		});
		// A guard's fail takes the fail edge, like the agent's own.
		expect(payloads(logged, "EdgeTaken")[0]?.to).toBe("fixer");
		expect(
			payloads(logged, "RunWarned").filter((w) => w.kind === "budget"),
		).toEqual([{ kind: "budget", message }]);
	});

	test("for another harness the engine counts the turns and stops the session past the limit", async () => {
		const harness = fakeHarness({
			steps: [
				call("Read", { path: "a.ts" }),
				call("Read", { path: "b.ts" }),
				call("Read", { path: "c.ts" }),
				{ type: "wait", ms: 30_000 },
			],
		});
		const h = await startRun(
			sandbox,
			flowOf({
				start: "worker",
				nodes: [agent("worker", { harness: "opencode", maxTurns: 2 })],
				edges: [],
			}),
			{ harness, harnessName: "opencode" },
		);
		const { parked } = await drive(h, { inputs: {} });
		const message =
			"The agent reached its limit of 2 turns, so the step stopped.";
		expect(parked[0]).toMatchObject({
			status: "failed",
			reason:
				'Node "worker" ended with "fail" and no edge leaves it on that outcome.',
		});
		const logged = await h.events();
		expect(payloads(logged, "SessionEnded")[0]).toMatchObject({
			errorKind: "aborted",
		});
		expect(payloads(logged, "StepEnded")[0]).toMatchObject({
			outcome: "fail",
			error: message,
		});
		expect(payloads(logged, "RunWarned")).toEqual([
			{ kind: "budget", message },
		]);
	});
});

describe("the stall guard", () => {
	test("every Agent step gets the policy's idle limit; past it the step ends fail and the run warns it stalled", async () => {
		const harness = fakeHarness({
			steps: [
				{ type: "text", text: "Thinking." },
				{ type: "wait", ms: 30_000 },
			],
		});
		const h = await startRun(
			sandbox,
			withPolicy([agent("worker")], { idleMinutes: 1 }),
			{ harness },
		);
		const { parked } = await drive(h, { inputs: {} });
		const message =
			"The agent showed no activity for 1 min, so the step stopped.";
		const logged = await h.events();
		expect(payloads(logged, "StepStarted")[0]?.idleMs).toBe(MINUTE);
		expect(payloads(logged, "StepEnded")[0]).toMatchObject({
			outcome: "fail",
			error: message,
		});
		expect(payloads(logged, "RunWarned")).toEqual([
			{ kind: "stalled", message },
		]);
		expect(parked[0]).toMatchObject({ status: "failed" });
	});

	test("the node's own idle limit wins over the policy's", async () => {
		const harness = fakeHarness(reportingScript("pass"));
		const h = await startRun(
			sandbox,
			withPolicy([agent("worker", { idleMinutes: 3 })], { idleMinutes: 1 }),
			{ harness },
		);
		await drive(h, { inputs: {} });
		expect(payloads(await h.events(), "StepStarted")[0]?.idleMs).toBe(
			3 * MINUTE,
		);
	});
});

describe("the loop guard", () => {
	test("three identical tool calls in a row end the step fail, with a looping warning", async () => {
		const harness = fakeHarness({
			steps: [
				call("Bash", { command: "bun test" }),
				call("Bash", { command: "bun test" }),
				call("Bash", { command: "bun test" }),
				{ type: "wait", ms: 30_000 },
			],
		});
		const h = await startRun(
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			{ harness },
		);
		await drive(h, { inputs: {} });
		const logged = await h.events();
		const message =
			"The agent called Bash 3 times in a row with the same input, so the step stopped.";
		expect(payloads(logged, "StepEnded")[0]).toMatchObject({
			outcome: "fail",
			error: message,
		});
		expect(payloads(logged, "RunWarned")).toEqual([
			{ kind: "looping", message },
		]);
	});

	test("three different tool calls do not trip it", async () => {
		const harness = fakeHarness({
			...reportingScript("pass"),
			steps: [
				call("Bash", { command: "bun test" }),
				call("Bash", { command: "bun run lint" }),
				call("Bash", { command: "bun run build" }),
				...(reportingScript("pass").steps ?? []),
			],
		});
		const h = await startRun(
			sandbox,
			flowOf({ start: "worker", nodes: [agent("worker")], edges: [] }),
			{ harness },
		);
		const { state } = await drive(h, { inputs: {} });
		expect(state.ended?.status).toBe("finished");
		expect(payloads(await h.events(), "RunWarned")).toEqual([]);
	});
});
