import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness, reportingScript } from "@nightshift/agents/fake";
import type { AgentHarness } from "@nightshift/agents/types";
import { event } from "@nightshift/db/schema/nightshift";
import {
	type AgentNode,
	type CommandNode,
	type Flow,
	type FlowEdge,
	singleAgentFlow,
} from "@nightshift/flows";
import { asc } from "drizzle-orm";

import { createEngine, type EngineInternals } from "./engine";
import {
	createSandbox,
	mustGit,
	type Sandbox,
	scriptedHarness,
	waitFor,
} from "./test-support";
import type {
	Engine,
	EngineOptions,
	RunStatus,
	RunStreamItem,
	TranscriptEntry,
} from "./types";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

function makeEngine(
	harness: AgentHarness,
	options: Pick<EngineOptions, "maxConcurrentRuns" | "maxStepsPerRun"> = {},
	internals: EngineInternals = {},
): Engine {
	return createEngine(
		{
			db: sandbox.db,
			harnesses: { "claude-code": harness },
			dataDir: sandbox.dataDir,
			...options,
		},
		internals,
	);
}

function agent(
	id: string,
	prompt: string,
	extra: Partial<AgentNode> = {},
): AgentNode {
	return {
		id,
		type: "agent",
		position: { x: 0, y: 0 },
		prompt,
		harness: "claude-code",
		model: "sonnet",
		permissionMode: "acceptEdits",
		session: "fresh",
		...extra,
	};
}

function command(id: string, cmd: string): CommandNode {
	return { id, type: "command", position: { x: 0, y: 0 }, command: cmd };
}

function edge(
	id: string,
	from: string,
	outcome: FlowEdge["outcome"],
	to: string,
	max?: number,
): FlowEdge {
	return max === undefined
		? { id, from, outcome, to }
		: { id, from, outcome, to, max };
}

function flowOf(nodes: Flow["nodes"], edges: FlowEdge[] = []): Flow {
	return { version: 1, start: nodes[0]?.id ?? "", nodes, edges };
}

/** Counts its own runs in the worktree and fails until the given attempt. */
const passOnAttempt = (attempt: number) =>
	`n=$(cat .attempts 2>/dev/null || echo 0); n=$((n+1)); echo $n > .attempts; echo "attempt $n"; test $n -ge ${attempt}`;

/** worker → check on pass; check → worker on fail, at most `max` times. */
function retryFlow(check: string, max: number): Flow {
	return flowOf(
		[agent("worker", "Fix it.\n{{check.log_tail}}"), command("check", check)],
		[
			edge("e1", "worker", "pass", "check"),
			edge("e2", "check", "fail", "worker", max),
		],
	);
}

async function projectId(engine: Engine): Promise<string> {
	return (await engine.addProject({ repoPath: sandbox.repoPath })).id;
}

async function statusOf(engine: Engine, runId: string): Promise<RunStatus> {
	return (await engine.getRun(runId)).status;
}

async function waitForStatus(engine: Engine, runId: string, status: RunStatus) {
	await waitFor(async () => (await statusOf(engine, runId)) === status, {
		label: `status ${status}`,
	});
}

async function waitForEnd(engine: Engine, runId: string): Promise<RunStatus> {
	return waitFor(
		async () => {
			const status = await statusOf(engine, runId);
			return status === "running" ? null : status;
		},
		{ label: "the run to end" },
	);
}

async function loggedTypes(): Promise<string[]> {
	const rows = await sandbox.db.select().from(event).orderBy(asc(event.seq));
	return rows.map((r) => r.type);
}

/** Watches a run until `until` says stop, and returns every item. */
async function collect(
	engine: Engine,
	runId: string,
	until: (item: RunStreamItem, items: RunStreamItem[]) => boolean,
	afterSeq?: number,
): Promise<RunStreamItem[]> {
	const controller = new AbortController();
	const items: RunStreamItem[] = [];
	const timeout = setTimeout(() => controller.abort(), 5_000);
	for await (const item of engine.watchRun(runId, {
		signal: controller.signal,
		afterSeq,
	})) {
		items.push(item);
		if (until(item, items)) controller.abort();
	}
	clearTimeout(timeout);
	return items;
}

const entriesOf = (items: RunStreamItem[]): TranscriptEntry[] =>
	items.flatMap((i) => (i.kind === "transcript" ? [i.entry] : []));
const statusesOf = (items: RunStreamItem[]): RunStatus[] =>
	items.flatMap((i) => (i.kind === "status" ? [i.status] : []));
const isStatus = (status: RunStatus) => (item: RunStreamItem) =>
	item.kind === "status" && item.status === status;

async function readTranscript(path: string): Promise<TranscriptEntry[]> {
	const text = await readFile(path, "utf8");
	return text
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l) as TranscriptEntry);
}

describe("projects", () => {
	test("addProject rejects a path that is not a git repository", async () => {
		const engine = makeEngine(scriptedHarness().harness);
		const plain = join(sandbox.root, "plain");
		await mkdir(plain);
		await expect(engine.addProject({ repoPath: plain })).rejects.toThrow(
			"Not a git repository",
		);
		expect(await engine.listProjects()).toEqual([]);
	});

	test("addProject stores the repo top level and is idempotent", async () => {
		const engine = makeEngine(scriptedHarness().harness);
		const first = await engine.addProject({ repoPath: sandbox.repoPath });
		expect(first.name).toBe("repo");
		expect(first.repoPath).toBe(sandbox.repoPath);
		const again = await engine.addProject({
			repoPath: `${sandbox.repoPath}/`,
			name: "other",
		});
		expect(again.id).toBe(first.id);
		expect(await engine.listProjects()).toHaveLength(1);
	});

	test("removal is soft: runs stay, and adding the path restores it", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const id = await projectId(engine);
		const run = await engine.startRun({
			projectId: id,
			flow: singleAgentFlow({
				prompt: "Do it",
				model: "sonnet",
				permissionMode: "default",
			}),
		});
		await waitFor(() => sessions[0]);
		await expect(engine.removeProject(id)).rejects.toThrow("still running");
		sessions[0]?.finish();
		await waitForStatus(engine, run.id, "finished");

		await engine.removeProject(id);
		expect(await engine.listProjects()).toEqual([]);
		expect((await engine.listRuns()).map((r) => r.id)).toEqual([run.id]);
		expect((await engine.getRun(run.id)).status).toBe("finished");
		await expect(engine.listFlows(id)).rejects.toThrow("Project not found");
		await expect(
			engine.startRun({ projectId: id, flowName: "anything" }),
		).rejects.toThrow("Project not found");

		const restored = await engine.addProject({ repoPath: sandbox.repoPath });
		expect(restored.id).toBe(id);
		expect(await engine.listProjects()).toHaveLength(1);
		expect(await loggedTypes()).toContain("ProjectRestored");
	});
});

describe("flows", () => {
	test("save, list, get and delete go to .nightshift/flows in the clone", async () => {
		const engine = makeEngine(scriptedHarness().harness);
		const id = await projectId(engine);
		const flow = retryFlow("true", 2);
		expect(await engine.saveFlow(id, "retry", flow)).toEqual([]);
		expect(
			existsSync(join(sandbox.repoPath, ".nightshift", "flows", "retry.json")),
		).toBe(true);
		expect((await engine.listFlows(id)).map((f) => f.name)).toEqual(["retry"]);
		expect((await engine.getFlow(id, "retry")).flow).toEqual(flow);
		await engine.deleteFlow(id, "retry");
		expect(await engine.listFlows(id)).toEqual([]);
	});
});

describe("runs", () => {
	test("a quick run walks one agent node to finished", async () => {
		const harness = fakeHarness({
			steps: [
				{ type: "text", text: "Looking." },
				{ type: "tool", name: "Read", result: "x" },
				{ type: "text", text: "All done." },
			],
			outcome: {
				type: "finished",
				usage: { inputTokens: 1, outputTokens: 1, costUsd: 0.12 },
			},
		});
		const engine = makeEngine(harness);
		const prompt = `Fix the bug${" in the parser".repeat(10)}`;
		const head = await mustGit(sandbox.repoPath, ["rev-parse", "HEAD"]);

		const summary = await engine.startRun({
			projectId: await projectId(engine),
			flow: singleAgentFlow({
				prompt,
				model: "sonnet",
				permissionMode: "acceptEdits",
				effort: "high",
				skill: "tdd",
			}),
		});
		expect(summary.status).toBe("running");
		expect(summary.flowName).toBeNull();
		expect(summary.title.length).toBeLessThanOrEqual(80);
		expect(summary.title.startsWith("Fix the bug in the parser")).toBe(true);
		expect(summary.baseRef).toBe(head);
		expect(summary.branch).toBe(`nightshift/${summary.id.slice(0, 8)}`);
		expect(summary.worktreePath).toBe(
			join(sandbox.root, "repo.nightshift", summary.id.slice(0, 8)),
		);
		expect(existsSync(join(summary.worktreePath, "README.md"))).toBe(true);

		expect(await waitForEnd(engine, summary.id)).toBe("finished");
		expect(harness.calls).toHaveLength(1);
		expect(harness.calls[0]).toMatchObject({
			cwd: summary.worktreePath,
			prompt: `/tdd ${prompt}`,
			model: "sonnet",
			permissionMode: "acceptEdits",
			effort: "high",
			stepReport: true,
		});

		const detail = await engine.getRun(summary.id);
		expect(detail.reason).toBeNull();
		expect(detail.costUsd).toBeCloseTo(0.12);
		expect(detail.flow.nodes[0]?.id).toBe("agent");
		expect(detail.steps).toHaveLength(1);
		const step = detail.steps[0];
		expect(step).toMatchObject({
			nodeId: "agent",
			nodeType: "agent",
			visit: 1,
			outcome: "pass",
			error: null,
			outputs: {
				outcome: "pass",
				output: "All done.",
				summary: "All done.",
				visit: 1,
				session_id: "fake-session-1",
			},
		});
		expect(step?.sessions).toHaveLength(1);
		expect(step?.sessions[0]).toMatchObject({
			harnessSessionId: "fake-session-1",
			outcome: "finished",
			costUsd: 0.12,
		});
		expect(detail.takeOverCommand).toBe(
			`cd ${summary.worktreePath} && claude --resume fake-session-1`,
		);
		expect((await engine.listRuns())[0]).toMatchObject({
			id: summary.id,
			status: "finished",
		});

		expect(await loggedTypes()).toEqual([
			"ProjectAdded",
			"RunStarted",
			"WorktreeCreated",
			"StepStarted",
			"SessionStarted",
			"HarnessSessionAssigned",
			"SessionEnded",
			"StepEnded",
			"RunEnded",
		]);

		const transcript = await readTranscript(
			join(sandbox.dataDir, "transcripts", summary.id, `${step?.id}.ndjson`),
		);
		expect(transcript[0]).toMatchObject({ seq: 1, stepId: step?.id });
		expect(transcript.map((e) => e.seq)).toEqual(
			transcript.map((_, i) => i + 1),
		);
		expect(transcript.at(-1)?.event.type).toBe("finished");
	});

	test("worker → check → worker retries until the check passes", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: retryFlow(passOnAttempt(3), 3),
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");

		const detail = await engine.getRun(run.id);
		expect(
			detail.steps.map((s) => [s.nodeId, s.visit, s.outcome, s.nodeType]),
		).toEqual([
			["worker", 1, "pass", "agent"],
			["check", 1, "fail", "command"],
			["worker", 2, "pass", "agent"],
			["check", 2, "fail", "command"],
			["worker", 3, "pass", "agent"],
			["check", 3, "pass", "command"],
		]);
		expect(detail.traversals).toEqual({ e1: 3, e2: 2 });
		expect(detail.steps[1]?.outputs).toEqual({
			outcome: "fail",
			exit_code: 1,
			log_tail: "attempt 1",
			visit: 1,
		});
		expect(detail.steps[5]?.outputs).toMatchObject({ exit_code: 0 });

		// The template fed the check's log tail into the worker's next prompt.
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			"Fix it.\n",
			"Fix it.\nattempt 1",
			"Fix it.\nattempt 2",
		]);

		// The command's output is in its transcript and its log.
		const check = detail.steps[1];
		const entries = await readTranscript(
			join(sandbox.dataDir, "transcripts", run.id, `${check?.id}.ndjson`),
		);
		expect(entries.map((e) => e.event)).toEqual([
			{ type: "command-start", command: passOnAttempt(3) },
			{ type: "command-output", stream: "stdout", text: "attempt 1\n" },
			{ type: "command-exit", exitCode: 1 },
		]);
		expect(entries.every((e) => e.sessionId === null)).toBe(true);
		expect(
			await readFile(
				join(sandbox.dataDir, "logs", run.id, `${check?.id}.log`),
				"utf8",
			),
		).toBe("attempt 1\n");
	});

	test("a loop that hits its max fails the run with a reason", async () => {
		const engine = makeEngine(fakeHarness());
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: retryFlow("echo nope; exit 1", 2),
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		const detail = await engine.getRun(run.id);
		expect(detail.steps.map((s) => s.nodeId)).toEqual([
			"worker",
			"check",
			"worker",
			"check",
			"worker",
			"check",
		]);
		expect(detail.traversals).toEqual({ e1: 3, e2: 2 });
		expect(detail.reason).toContain('"e2"');
		expect(detail.reason).toContain("max 2");
		expect(detail.reason).toContain('Node "check" ended with "fail"');
	});

	test("an agent that reports fail takes the fail edge", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const flow = flowOf(
			[
				agent("worker", "Build it"),
				agent("rescue", "Rescue: {{worker.summary}}"),
				command("done", "true"),
			],
			[
				edge("e1", "worker", "pass", "done"),
				edge("e2", "worker", "fail", "rescue"),
			],
		);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow,
		});
		const worker = await waitFor(() => sessions[0]);
		worker.text("I could not.");
		worker.emit({ type: "report", outcome: "pass", summary: "first" });
		worker.emit({ type: "report", outcome: "fail", summary: "Tests fail." });
		worker.finish();

		const rescue = await waitFor(() => sessions[1], { label: "rescue" });
		expect(rescue.input.prompt).toBe("Rescue: Tests fail.");
		expect(rescue.input.resumeSessionId).toBeUndefined();
		rescue.finish();
		expect(await waitForEnd(engine, run.id)).toBe("finished");

		const detail = await engine.getRun(run.id);
		expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["worker", "fail"],
			["rescue", "pass"],
		]);
		expect(detail.steps[0]?.outputs).toMatchObject({
			outcome: "fail",
			output: "I could not.",
			summary: "Tests fail.",
		});
		expect(detail.traversals).toEqual({ e2: 1 });
	});

	test("the fake harness's step report routes the walk", async () => {
		const harness = fakeHarness((_input, call) =>
			call === 0 ? reportingScript("fail", "Tests fail.") : {},
		);
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[agent("worker", "Build it"), agent("rescue", "{{worker.summary}}")],
				[edge("e1", "worker", "fail", "rescue")],
			),
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			"Build it",
			"Tests fail.",
		]);
		expect((await engine.getRun(run.id)).steps.map((s) => s.outcome)).toEqual([
			"fail",
			"pass",
		]);
	});

	test("an outcome without an edge fails the run", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", "Build it")]),
		});
		const worker = await waitFor(() => sessions[0]);
		worker.emit({ type: "report", outcome: "needs-input", summary: "Which?" });
		worker.finish();
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		expect((await engine.getRun(run.id)).reason).toBe(
			'Node "worker" ended with "needs-input" and no edge leaves it on that outcome.',
		);
	});

	test("a harness error fails the step and the run", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", "Build it")]),
		});
		(await waitFor(() => sessions[0])).fail("boom");
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		const detail = await engine.getRun(run.id);
		expect(detail.steps[0]).toMatchObject({ outcome: "error", error: "boom" });
		expect(detail.steps[0]?.sessions[0]?.outcome).toBe("failed");
		expect(detail.reason).toBe('Node "worker" failed: boom');
	});

	test("session resume continues the node's last harness session", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(harness);
		const flow = flowOf(
			[
				agent("worker", "Try {{worker.visit}}", { session: "resume" }),
				command("check", passOnAttempt(2)),
			],
			[
				edge("e1", "worker", "pass", "check"),
				edge("e2", "check", "fail", "worker", 1),
			],
		);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow,
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(
			harness.calls.map((c) => [c.prompt, c.resumeSessionId ?? null]),
		).toEqual([
			["Try ", null],
			["Try 1", "fake-session-1"],
		]);
	});

	test("a step that runs past its timeout errors and fails the run", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness, {}, { minuteMs: 50 });
		const id = await projectId(engine);
		const slowAgent = await engine.startRun({
			projectId: id,
			flow: flowOf([agent("worker", "Go", { timeoutMinutes: 1 })]),
		});
		(await waitFor(() => sessions[0])).text("thinking");
		expect(await waitForEnd(engine, slowAgent.id)).toBe("failed");
		let detail = await engine.getRun(slowAgent.id);
		expect(detail.steps[0]).toMatchObject({
			outcome: "error",
			error: "The step ran past its time budget of 1 min.",
		});
		expect(detail.steps[0]?.sessions[0]?.outcome).toBe("failed");

		const slowCommand = await engine.startRun({
			projectId: id,
			flow: flowOf([{ ...command("check", "sleep 30"), timeoutMinutes: 1 }]),
		});
		expect(await waitForEnd(engine, slowCommand.id)).toBe("failed");
		detail = await engine.getRun(slowCommand.id);
		expect(detail.steps[0]?.outcome).toBe("error");
		expect(detail.reason).toContain("budget");
	});

	test("maxStepsPerRun fails a runaway run", async () => {
		const engine = makeEngine(fakeHarness(), { maxStepsPerRun: 3 });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: retryFlow("exit 1", 10),
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		const detail = await engine.getRun(run.id);
		expect(detail.steps).toHaveLength(3);
		expect(detail.reason).toContain("limit of 3 steps");
	});

	test("refuses a flow with errors and leaves nothing behind", async () => {
		const engine = makeEngine(scriptedHarness().harness);
		const id = await projectId(engine);
		const unbounded = flowOf(
			[agent("worker", "Go"), command("check", "true")],
			[
				edge("e1", "worker", "pass", "check"),
				edge("e2", "check", "fail", "worker"),
			],
		);
		await expect(
			engine.startRun({ projectId: id, flow: unbounded }),
		).rejects.toThrow("The flow cannot run");

		await engine.saveFlow(id, "broken", { ...unbounded, start: "nowhere" });
		const error = await engine
			.startRun({ projectId: id, flowName: "broken" })
			.catch((e: Error) => e);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("nowhere");

		expect(await engine.listRuns()).toEqual([]);
		expect(existsSync(join(sandbox.root, "repo.nightshift"))).toBe(false);
	});

	test("a flow file runs by name and keeps its snapshot", async () => {
		const engine = makeEngine(fakeHarness());
		const id = await projectId(engine);
		await engine.saveFlow(id, "night", retryFlow("true", 2));
		const run = await engine.startRun({ projectId: id, flowName: "night" });
		expect(run.flowName).toBe("night");
		expect(run.title).toBe("night");
		await engine.deleteFlow(id, "night");
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect((await engine.getRun(run.id)).flow.nodes.map((n) => n.id)).toEqual([
			"worker",
			"check",
		]);
	});

	test("the run cap refuses a run beyond it", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness, { maxConcurrentRuns: 1 });
		const id = await projectId(engine);
		const input = { projectId: id, flow: flowOf([agent("worker", "Go")]) };
		const first = await engine.startRun(input);
		await waitFor(() => sessions[0]);

		await expect(engine.startRun(input)).rejects.toThrow(
			"The run cap is reached: 1 of 1",
		);
		expect(await engine.listRuns()).toHaveLength(1);

		await engine.stopRun(first.id);
		const second = await engine.startRun(input);
		await expect(engine.resumeRun(first.id)).rejects.toThrow(
			"The run cap is reached",
		);
		(await waitFor(() => sessions[1])).finish();
		await waitForStatus(engine, second.id, "finished");
	});

	test("starting two runs at once cannot pass the cap", async () => {
		const engine = makeEngine(scriptedHarness().harness, {
			maxConcurrentRuns: 1,
		});
		const input = {
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", "Go")]),
		};
		const results = await Promise.allSettled([
			engine.startRun(input),
			engine.startRun(input),
		]);
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		for (const run of await engine.listRuns()) await engine.stopRun(run.id);
	});
});

describe("stop and resume", () => {
	test("stop aborts the agent step, and resume continues its session", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const flow = flowOf(
			[agent("worker", "Build it"), command("check", "echo ok")],
			[edge("e1", "worker", "pass", "check")],
		);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow,
		});
		const first = await waitFor(() => sessions[0]);
		first.text("working");

		await engine.stopRun(run.id);
		expect(first.input.signal.aborted).toBe(true);
		let detail = await engine.getRun(run.id);
		expect(detail.status).toBe("stopped");
		expect(detail.reason).toBeNull();
		expect(detail.steps[0]).toMatchObject({ outcome: "stopped" });
		expect(detail.steps[0]?.sessions[0]?.outcome).toBe("stopped");
		expect(await loggedTypes()).toContain("StopRequested");
		// Stopping a run that does not run is a no-op.
		await engine.stopRun(run.id);

		await engine.resumeRun(run.id);
		const second = await waitFor(() => sessions[1], { label: "resume" });
		expect(second.input.resumeSessionId).toBe("harness-0");
		expect(second.input.prompt).toBe("Continue where you left off.");
		expect(second.input.cwd).toBe(run.worktreePath);
		await expect(engine.resumeRun(run.id)).rejects.toThrow("still running");
		second.text("more");
		second.finish(0.5);
		expect(await waitForEnd(engine, run.id)).toBe("finished");

		detail = await engine.getRun(run.id);
		expect(detail.steps.map((s) => [s.nodeId, s.visit, s.outcome])).toEqual([
			["worker", 1, "pass"],
			["check", 1, "pass"],
		]);
		expect(detail.steps[0]?.sessions.map((s) => s.outcome)).toEqual([
			"stopped",
			"finished",
		]);
		expect(detail.steps[0]?.outputs).toMatchObject({
			output: "more",
			session_id: "harness-1",
		});
		expect(detail.takeOverCommand).toContain("--resume harness-1");
		expect(detail.costUsd).toBeCloseTo(0.5);

		// One transcript per step, seq increasing across sessions and steps.
		const items = await collect(engine, run.id, (_i, all) =>
			entriesOf(all).some((e) => e.event.type === "command-exit"),
		);
		const entries = entriesOf(items);
		expect(entries.map((e) => e.seq)).toEqual(entries.map((_, i) => i + 1));
		expect(entries.map((e) => e.event.type)).toEqual([
			"session",
			"text",
			"error",
			"session",
			"text",
			"finished",
			"command-start",
			"command-output",
			"command-exit",
		]);
	});

	test("resumeRun passes a prompt on", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", "Build it")]),
		});
		(await waitFor(() => sessions[0])).fail("usage limit");
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		await engine.resumeRun(run.id, "Also add tests");
		const second = await waitFor(() => sessions[1]);
		expect(second.input.prompt).toBe("Also add tests");
		second.finish();
		expect(await waitForEnd(engine, run.id)).toBe("finished");
	});

	test("stop kills a running command, and resume runs it again", async () => {
		const engine = makeEngine(scriptedHarness().harness);
		const flow = flowOf([command("check", "echo start; sleep 30")]);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow,
		});
		await waitFor(async () =>
			(await engine.getRun(run.id)).steps.some((s) => s.nodeId === "check"),
		);
		await Bun.sleep(50);
		const started = Date.now();
		await engine.stopRun(run.id);
		expect(Date.now() - started).toBeLessThan(2_000);
		const detail = await engine.getRun(run.id);
		expect(detail.status).toBe("stopped");
		expect(detail.steps[0]?.outcome).toBe("stopped");

		await engine.resumeRun(run.id);
		await waitFor(async () => (await engine.getRun(run.id)).steps.length === 2);
		await engine.stopRun(run.id);
		expect(
			(await engine.getRun(run.id)).steps.map((s) => [s.nodeId, s.visit]),
		).toEqual([
			["check", 1],
			["check", 2],
		]);
	});

	test("resume after an exhausted loop runs the check again with the counts kept", async () => {
		const engine = makeEngine(fakeHarness());
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: retryFlow(passOnAttempt(3), 1),
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		let detail = await engine.getRun(run.id);
		expect(detail.traversals).toEqual({ e1: 2, e2: 1 });
		expect(detail.reason).toContain("max 1");

		await engine.resumeRun(run.id);
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		detail = await engine.getRun(run.id);
		expect(detail.reason).toBeNull();
		expect(detail.steps.map((s) => [s.nodeId, s.visit, s.outcome])).toEqual([
			["worker", 1, "pass"],
			["check", 1, "fail"],
			["worker", 2, "pass"],
			["check", 2, "fail"],
			["check", 3, "pass"],
		]);
		expect(detail.traversals).toEqual({ e1: 2, e2: 1 });
	});
});

describe("watchRun", () => {
	test("emits status and steps, replays from disk, then streams live", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[agent("worker", "Go"), command("check", "echo checked")],
				[edge("e1", "worker", "pass", "check")],
			),
		});
		const session = await waitFor(() => sessions[0]);
		for (let i = 0; i < 20; i++) session.text(`before-${i}`);
		await waitFor(async () => (await readTranscriptCount(run.id)) === 21, {
			label: "21 entries on disk",
		});

		// Keep emitting while the watcher subscribes and replays.
		const producer = (async () => {
			for (let i = 0; i < 50; i++) {
				session.text(`during-${i}`);
				if (i % 5 === 0) await Bun.sleep(0);
			}
			session.finish(0.01);
		})();
		const items = await collect(engine, run.id, isStatus("finished"));
		await producer;

		expect(items[0]).toEqual({ kind: "status", status: "running" });
		expect(items[1]).toMatchObject({
			kind: "step",
			step: { nodeId: "worker", outcome: null },
		});
		expect(statusesOf(items)).toEqual(["running", "finished"]);
		const seqs = entriesOf(items).map((e) => e.seq);
		// 1 session + 20 before + 50 during + 1 finished + 3 command entries
		expect(seqs).toEqual(Array.from({ length: 75 }, (_, i) => i + 1));
		const stepItems = items.flatMap((i) => (i.kind === "step" ? [i.step] : []));
		expect(stepItems.at(-1)).toMatchObject({
			nodeId: "check",
			outcome: "pass",
		});
		expect(
			stepItems.some((s) => s.nodeId === "worker" && s.outcome === "pass"),
		).toBe(true);
		expect(items.at(-1)).toEqual({ kind: "status", status: "finished" });
	});

	test("afterSeq skips entries the caller has", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", "Go")]),
		});
		const session = await waitFor(() => sessions[0]);
		session.text("a");
		session.text("b");
		session.finish();
		await waitForStatus(engine, run.id, "finished");

		const items = await collect(
			engine,
			run.id,
			(_item, all) => entriesOf(all).length === 2,
			2,
		);
		expect(items[0]).toEqual({ kind: "status", status: "finished" });
		expect(items[1]).toMatchObject({ kind: "step", step: { outcome: "pass" } });
		expect(entriesOf(items).map((e) => e.seq)).toEqual([3, 4]);
	});

	test("rejects an unknown run", async () => {
		const engine = makeEngine(scriptedHarness().harness);
		const iterator = engine
			.watchRun("missing", { signal: new AbortController().signal })
			[Symbol.asyncIterator]();
		await expect(iterator.next()).rejects.toThrow("Run not found");
	});
});

describe("recovery", () => {
	test("work the daemon lost is interrupted, never continued on its own", async () => {
		// The first daemon's harness never ends: the daemon "dies" mid-step.
		const dying = scriptedHarness({ hang: true });
		const first = makeEngine(dying.harness);
		const run = await first.startRun({
			projectId: await projectId(first),
			flow: flowOf(
				[agent("worker", "Go"), command("check", "true")],
				[edge("e1", "worker", "pass", "check")],
			),
		});
		const lost = await waitFor(() => dying.sessions[0]);
		lost.text("partial work");
		await waitFor(async () => (await readTranscriptCount(run.id)) === 2);

		// A new daemon on the same database and data directory.
		const { harness, sessions } = scriptedHarness({
			harnessSessionId: () => "harness-0",
		});
		const second = makeEngine(harness);
		const detail = await second.getRun(run.id);
		expect(detail.status).toBe("interrupted");
		expect(detail.steps[0]).toMatchObject({ outcome: "interrupted" });
		expect(detail.steps[0]?.sessions[0]?.outcome).toBe("interrupted");
		expect(detail.takeOverCommand).toContain("--resume harness-0");
		await Bun.sleep(30);
		expect(sessions).toHaveLength(0);

		await second.resumeRun(run.id);
		const resumed = await waitFor(() => sessions[0]);
		expect(resumed.input.resumeSessionId).toBe("harness-0");
		resumed.finish();
		expect(await waitForEnd(second, run.id)).toBe("finished");

		const items = await collect(second, run.id, (_i, all) =>
			entriesOf(all).some((e) => e.event.type === "command-exit"),
		);
		expect(entriesOf(items).map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(
			(await second.getRun(run.id)).steps.map((s) => [s.nodeId, s.outcome]),
		).toEqual([
			["worker", "pass"],
			["check", "pass"],
		]);
	});
});

async function readTranscriptCount(runId: string): Promise<number> {
	const dir = join(sandbox.dataDir, "transcripts", runId);
	if (!existsSync(dir)) return 0;
	const files = await Array.fromAsync(new Bun.Glob("*.ndjson").scan(dir));
	let count = 0;
	for (const file of files) {
		const text = await readFile(join(dir, file), "utf8");
		count += text.split("\n").filter(Boolean).length;
	}
	return count;
}
