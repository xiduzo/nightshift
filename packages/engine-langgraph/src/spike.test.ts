/** SPIKE. Night Shift flows on LangGraph, driven by the fake harness. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Client, createClient } from "@libsql/client";
import {
	type AgentSessionInput,
	fakeDecider,
	fakeHarness,
} from "@nightshift/agents";
import { reportingScript, usageLimitScript } from "@nightshift/agents/fake";
import { type Flow, type FlowInput, flowSchema } from "@nightshift/flows";

import { createRunner, type StreamItem } from "./run";

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

const flow = (input: Omit<FlowInput, "version">): Flow =>
	flowSchema.parse({ version: 2, ...input });

async function collect(stream: AsyncIterable<StreamItem>) {
	const items: StreamItem[] = [];
	for await (const item of stream) items.push(item);
	return items;
}

let dir: string;
let client: Client;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "lg-spike-"));
	client = createClient({ url: `file:${join(dir, "runs.db")}` });
});
afterEach(async () => {
	client.close();
	await rm(dir, { recursive: true, force: true });
});

describe("flows on LangGraph", () => {
	test("walks agent → command to a chosen end and checkpoints every node in libsql", async () => {
		const harness = fakeHarness(reportingScript("pass", "Built it"));
		const runner = createRunner({
			client,
			services: { harnesses: { "claude-code": harness }, flows: {}, cwd: dir },
		});
		const f = flow({
			inputs: [{ name: "task" }],
			start: "worker",
			nodes: [
				agent("worker"),
				{
					id: "check",
					type: "command",
					position: { x: 0, y: 0 },
					command: "echo checked {{worker.summary}}",
				},
			],
			edges: [{ id: "e1", from: "worker", outcome: "pass", to: "check" }],
		});

		const items = await collect(
			runner.start("run-1", f, { task: "the thing" }),
		);
		const events = items.filter((i) => i.kind === "event").map((i) => i.event);
		expect(events.map((e) => e.type)).toEqual([
			"step-started",
			"agent", // session
			"agent", // text deltas…
			"agent",
			"agent", // report
			"agent", // finished
			"step-ended",
			"step-started",
			"step-ended",
		]);
		expect(harness.calls[0]?.prompt).toBe("Work on worker: the thing");

		const state = await runner.state("run-1", f);
		expect(state.values.ended).toEqual({
			status: "finished",
			nodeId: "check",
			outcome: "pass",
			reason: null,
		});
		expect(state.values.nodes.worker?.summary).toBe("Built it");
		expect(state.values.nodes.check?.output).toBe("checked Built it");
		expect(state.values.traversals).toEqual({ e1: 1 });
		expect(state.values.steps.map((s) => `${s.nodeId}:${s.outcome}`)).toEqual([
			"worker:pass",
			"check:pass",
		]);

		const history = await runner.history("run-1", f);
		// input, after worker, after check: one checkpoint per super-step.
		expect(history.map((h) => h.next)).toEqual([
			[],
			["check"],
			["worker"],
			["__start__"],
		]);
		const { rows } = await client.execute(
			"SELECT count(*) AS n FROM lg_checkpoints WHERE thread_id = 'run-1'",
		);
		expect(Number(rows[0]?.n)).toBe(4);
	});

	test("a usage limit parks the run; a new runner over the same database continues the same session", async () => {
		const resetAt = Date.now() + 60_000;
		const harness = fakeHarness((_input: AgentSessionInput, call: number) =>
			call === 0
				? usageLimitScript(resetAt)
				: reportingScript("pass", "Finished after the wait"),
		);
		const services = {
			harnesses: { "claude-code": harness },
			flows: {},
			cwd: dir,
		};
		const f = flow({ start: "worker", nodes: [agent("worker")], edges: [] });

		const first = createRunner({ client, services });
		const items = await collect(first.start("run-2", f));
		const parked = items.find((i) => i.kind === "parked");
		expect(parked?.parked).toEqual({
			kind: "wait",
			nodeId: "worker",
			reason: "usage-limit",
			message: "You've hit your limit",
			resetAt,
		});
		const before = await first.state("run-2", f);
		expect(before.next).toEqual(["wait__worker"]);
		expect(before.values.pending?.harnessSessionId).toBe("fake-session-1");
		expect(before.values.ended).toBeNull();

		// "The daemon restarts": a fresh runner and a fresh client on the same file.
		const client2 = createClient({ url: `file:${join(dir, "runs.db")}` });
		const second = createRunner({ client: client2, services });
		await collect(
			second.resume("run-2", f, { prompt: "Carry on, the limit reset." }),
		);
		const after = await second.state("run-2", f);
		expect(after.values.ended?.status).toBe("finished");
		expect(after.values.pending).toBeNull();
		expect(after.values.visits.worker).toBe(1);
		expect(harness.calls).toHaveLength(2);
		expect(harness.calls[1]?.resumeSessionId).toBe("fake-session-1");
		expect(harness.calls[1]?.prompt).toBe("Carry on, the limit reset.");
		client2.close();
	});

	test("a Gate interrupts with its question and the answer picks the edge", async () => {
		const harness = fakeHarness(reportingScript("pass"));
		const runner = createRunner({
			client,
			services: { harnesses: { "claude-code": harness }, flows: {}, cwd: dir },
		});
		const f = flow({
			start: "ask",
			nodes: [
				{
					id: "ask",
					type: "gate",
					position: { x: 0, y: 0 },
					question: "Ship it?",
					choices: [{ name: "ship" }, { name: "hold" }],
				},
				agent("deploy"),
			],
			edges: [{ id: "e1", from: "ask", outcome: "ship", to: "deploy" }],
		});
		const items = await collect(runner.start("run-3", f));
		expect(items.at(-1)).toEqual({
			kind: "parked",
			parked: {
				kind: "gate",
				nodeId: "ask",
				question: "Ship it?",
				choices: ["ship", "hold"],
			},
		});
		expect(harness.calls).toHaveLength(0);

		await collect(runner.resume("run-3", f, "ship"));
		const state = await runner.state("run-3", f);
		expect(state.values.nodes.ask?.choice).toBe("ship");
		expect(state.values.ended?.nodeId).toBe("deploy");
		expect(harness.calls).toHaveLength(1);
	});

	test("an edge with a max stops a retry loop", async () => {
		const harness = fakeHarness(reportingScript("fail", "Nope"));
		const runner = createRunner({
			client,
			services: { harnesses: { "claude-code": harness }, flows: {}, cwd: dir },
		});
		const f = flow({
			start: "worker",
			nodes: [agent("worker")],
			edges: [
				{ id: "retry", from: "worker", outcome: "fail", to: "worker", max: 2 },
			],
		});
		await collect(runner.start("run-4", f));
		const state = await runner.state("run-4", f);
		expect(state.values.visits.worker).toBe(3);
		expect(state.values.traversals.retry).toBe(2);
		expect(state.values.ended?.status).toBe("failed");
		expect(state.values.ended?.reason).toContain(
			'edge "retry" reached its max',
		);
	});

	test("a Decision routes on the decider's label", async () => {
		const harness = fakeHarness(reportingScript("pass"));
		const decider = fakeDecider([
			{ kind: "decided", label: "small", notes: "trivial", costUsd: 0 },
		]);
		const runner = createRunner({
			client,
			services: {
				harnesses: { "claude-code": harness },
				decider,
				flows: {},
				cwd: dir,
			},
		});
		const f = flow({
			start: "triage",
			nodes: [
				{
					id: "triage",
					type: "decision",
					position: { x: 0, y: 0 },
					prompt: "How big?",
					labels: [{ name: "small" }, { name: "large" }],
				},
				agent("quick"),
				agent("deep"),
			],
			edges: [
				{ id: "s", from: "triage", outcome: "small", to: "quick" },
				{ id: "l", from: "triage", outcome: "large", to: "deep" },
			],
		});
		await collect(runner.start("run-5", f));
		const state = await runner.state("run-5", f);
		expect(state.values.steps.map((s) => s.nodeId)).toEqual([
			"triage",
			"quick",
		]);
	});

	test("For Each runs the body flow per element, and a wait inside an element resumes inside it", async () => {
		const harness = fakeHarness((_input: AgentSessionInput, call: number) =>
			call === 1 ? usageLimitScript() : reportingScript("pass", `done ${call}`),
		);
		const body = flow({
			inputs: [{ name: "item", type: "json" }],
			outputs: [{ name: "note", value: "{{work.summary}}" }],
			start: "work",
			nodes: [agent("work", { prompt: "Do {{item.title}}" })],
			edges: [],
		});
		const main = flow({
			start: "each",
			nodes: [
				{
					id: "each",
					type: "foreach",
					position: { x: 0, y: 0 },
					source: {
						kind: "json",
						value:
							'[{"id":"a","title":"A"},{"id":"b","title":"B"},{"id":"c","title":"C"}]',
					},
					flow: "body",
				},
			],
			edges: [],
		});
		const services = {
			harnesses: { "claude-code": harness },
			flows: { body },
			cwd: dir,
		};
		const runner = createRunner({ client, services });

		const items = await collect(runner.start("run-6", main));
		expect(items.at(-1)?.kind).toBe("parked");
		expect(harness.calls.map((c) => c.prompt)).toEqual(["Do A", "Do B"]);

		await collect(
			createRunner({ client, services }).resume("run-6", main, undefined),
		);
		const state = await runner.state("run-6", main);
		expect(
			harness.calls.map((c) => [c.prompt, c.resumeSessionId ?? null]),
		).toEqual([
			["Do A", null],
			["Do B", null],
			["Continue where you left off.", "fake-session-2"],
			["Do C", null],
		]);
		expect(state.values.ended).toEqual({
			status: "finished",
			nodeId: "each",
			outcome: "done",
			reason: null,
		});
		expect(state.values.nodes.each?.count).toBe(3);
	});

	test("time travel: a run forks from an earlier checkpoint and replays from there", async () => {
		const harness = fakeHarness(reportingScript("pass"));
		const runner = createRunner({
			client,
			services: { harnesses: { "claude-code": harness }, flows: {}, cwd: dir },
		});
		const f = flow({
			start: "a",
			nodes: [agent("a"), agent("b")],
			edges: [{ id: "e", from: "a", outcome: "pass", to: "b" }],
		});
		await collect(runner.start("run-7", f));
		expect(harness.calls).toHaveLength(2);
		const history = await runner.history("run-7", f);
		const afterA = history.find((h) => h.next[0] === "b");
		expect(afterA).toBeDefined();
		for await (const _ of await runner.fork(
			"run-7",
			f,
			afterA?.checkpointId as string,
		)) {
		}
		// Only b ran again; a's work was kept.
		expect(harness.calls).toHaveLength(3);
		const state = await runner.state("run-7", f);
		expect(state.values.steps.map((s) => s.nodeId)).toEqual(["a", "b"]);
		expect((await runner.history("run-7", f)).length).toBeGreaterThan(
			history.length,
		);
	});
});
