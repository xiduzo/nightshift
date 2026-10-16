import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness, reportingScript } from "@nightshift/agents/fake";
import type {
	AgentHarness,
	Decider,
	DecisionInput,
	DecisionResult,
} from "@nightshift/agents/types";
import { event } from "@nightshift/db/schema/nightshift";
import {
	type AgentNode,
	type CommandNode,
	type DecisionNode,
	type Flow,
	type FlowEdge,
	type GateNode,
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
	RunDetail,
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
	options: Pick<
		EngineOptions,
		"maxConcurrentRuns" | "maxStepsPerRun" | "decider"
	> = {},
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
		tools: [],
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

	test("the flow's policy maxSteps overrides the engine's limit", async () => {
		const engine = makeEngine(fakeHarness(), { maxStepsPerRun: 3 });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: {
				...retryFlow("exit 1", 10),
				policy: {
					usageLimitFirstWaitMinutes: 5,
					usageLimitMaxWaitMinutes: 60,
					networkGraceMinutes: 240,
					maxSteps: 5,
				},
			},
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		const detail = await engine.getRun(run.id);
		expect(detail.steps).toHaveLength(5);
		expect(detail.reason).toContain("limit of 5 steps");
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

function decision(
	id: string,
	prompt: string,
	labels: string[],
	extra: Partial<DecisionNode> = {},
): DecisionNode {
	return {
		id,
		type: "decision",
		position: { x: 0, y: 0 },
		prompt,
		labels: labels.map((name) => ({ name })),
		decider: "claude-code",
		model: "haiku",
		tools: [],
		...extra,
	};
}

function gate(
	id: string,
	question: string,
	choices: string[],
	extra: Partial<GateNode> = {},
): GateNode {
	return {
		id,
		type: "gate",
		position: { x: 0, y: 0 },
		question,
		choices: choices.map((name) => ({ name })),
		...extra,
	};
}

const decided = (
	label: string,
	notes = "",
	costUsd: number | null = null,
): DecisionResult => ({ kind: "decided", label, notes, costUsd });

/** A decider the test scripts per call (0-based). Never a real session. */
function scriptedDecider(
	answer: (
		input: DecisionInput,
		call: number,
	) => DecisionResult | Promise<DecisionResult>,
) {
	const calls: DecisionInput[] = [];
	const decider: Decider = {
		name: "test",
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

function sessionCostOf(detail: RunDetail): number {
	const sessions = detail.steps.flatMap((s) => s.sessions);
	return sessions.reduce((sum, s) => sum + (s.costUsd ?? 0), 0);
}

async function stepEntries(runId: string, stepId: string | undefined) {
	return readTranscript(
		join(sandbox.dataDir, "transcripts", runId, `${stepId}.ndjson`),
	);
}

describe("decisions", () => {
	test("a label with no edge is a chosen end: the run finishes", async () => {
		const { decider } = scriptedDecider(() => decided("stop", "Done.", 0.01));
		const engine = makeEngine(fakeHarness(), { decider });
		const flow = flowOf(
			[decision("decide", "Continue?", ["continue", "stop"])],
			[edge("e1", "decide", "continue", "decide", 2)],
		);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow,
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		const detail = await engine.getRun(run.id);
		expect(detail.reason).toBe('Ended at node "decide" with "stop".');
	});

	test("a decision routes the walk along the edge of its label", async () => {
		const harness = fakeHarness((_input, call) =>
			call === 0 ? reportingScript("pass", "Built the parser.") : {},
		);
		const { decider, calls } = scriptedDecider(() =>
			decided("ship", "The tests pass.", 0.02),
		);
		const engine = makeEngine(harness, { decider });
		const flow = flowOf(
			[
				agent("worker", "Build it"),
				decision(
					"decide",
					"Worker said: {{worker.summary}}",
					["ship", "redo"],
					{
						labels: [
							{ name: "ship", description: "Good enough" },
							{ name: "redo" },
						],
						tools: ["github"],
					},
				),
				agent("shipper", "Ship it. {{decide.notes}} ({{decide.outcome}})"),
			],
			[
				edge("e1", "worker", "pass", "decide"),
				edge("e2", "decide", "ship", "shipper"),
				edge("e3", "decide", "redo", "worker", 2),
			],
		);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow,
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			cwd: run.worktreePath,
			prompt: "Worker said: Built the parser.",
			labels: [{ name: "ship", description: "Good enough" }, { name: "redo" }],
			model: "haiku",
			tools: ["github"],
		});
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			"Build it",
			"Ship it. The tests pass. (ship)",
		]);

		const detail = await engine.getRun(run.id);
		expect(detail.traversals).toEqual({ e1: 1, e2: 1 });
		const step = detail.steps[1];
		expect(step).toMatchObject({
			nodeId: "decide",
			nodeType: "decision",
			outcome: "ship",
			error: null,
			outputs: { outcome: "ship", notes: "The tests pass.", visit: 1 },
			sessions: [],
		});
		expect(step?.costUsd).toBeCloseTo(0.02);
		// The run's cost is its sessions' cost plus the decider's.
		expect(detail.costUsd).toBeCloseTo(sessionCostOf(detail) + 0.02);
		expect((await engine.listRuns())[0]?.costUsd).toBeCloseTo(detail.costUsd);

		expect((await stepEntries(run.id, step?.id)).map((e) => e.event)).toEqual([
			{
				type: "decision-start",
				prompt: "Worker said: Built the parser.",
				labels: ["ship", "redo"],
				model: "haiku",
			},
			{ type: "decision", label: "ship", notes: "The tests pass." },
		]);
	});

	test("a decider error fails the step and the run, and its cost counts", async () => {
		const { decider } = scriptedDecider(() => ({
			kind: "error",
			errorKind: "harness",
			message: "boom",
			costUsd: 0.03,
		}));
		const engine = makeEngine(fakeHarness(), { decider });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[decision("decide", "Go?", ["yes", "no"]), command("done", "true")],
				[edge("e1", "decide", "yes", "done")],
			),
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		const detail = await engine.getRun(run.id);
		expect(detail.steps[0]).toMatchObject({
			outcome: "error",
			error: "The decider failed: boom",
			outputs: { outcome: "error", notes: "", visit: 1 },
		});
		expect(detail.reason).toBe(
			'Node "decide" failed: The decider failed: boom',
		);
		expect(detail.costUsd).toBeCloseTo(0.03);
	});

	test("a label that is not one of the node's labels is an error", async () => {
		const { decider } = scriptedDecider(() => decided("maybe", "Unsure."));
		const engine = makeEngine(fakeHarness(), { decider });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[decision("decide", "Go?", ["yes", "no"]), command("done", "true")],
				[edge("e1", "decide", "yes", "done")],
			),
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		const detail = await engine.getRun(run.id);
		expect(detail.steps[0]?.outcome).toBe("error");
		expect(detail.steps[0]?.error).toBe(
			'The decider picked "maybe", which is not a label of this node. The labels are: yes, no.',
		);
		expect(detail.steps).toHaveLength(1);
	});

	test("startRun refuses a flow with a Decision node when no decider is configured", async () => {
		const engine = makeEngine(fakeHarness());
		await expect(
			engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf([decision("decide", "Go?", ["yes", "no"])]),
			}),
		).rejects.toThrow("no decider is configured");
		expect(await engine.listRuns()).toEqual([]);
		expect(existsSync(join(sandbox.root, "repo.nightshift"))).toBe(false);
	});

	test("a decision that runs past its timeout errors", async () => {
		const { decider } = scriptedDecider(waitForAbort);
		const engine = makeEngine(fakeHarness(), { decider }, { minuteMs: 50 });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				decision("decide", "Go?", ["yes", "no"], { timeoutMinutes: 1 }),
			]),
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		const detail = await engine.getRun(run.id);
		expect(detail.steps[0]).toMatchObject({
			outcome: "error",
			error: "The step ran past its time budget of 1 min.",
		});
		expect(detail.steps[0]?.costUsd).toBeCloseTo(0.001);
	});

	test("stop aborts a decision", async () => {
		const { decider, calls } = scriptedDecider(waitForAbort);
		const engine = makeEngine(fakeHarness(), { decider });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([decision("decide", "Go?", ["yes", "no"])]),
		});
		await waitFor(() => calls[0]);
		await engine.stopRun(run.id);
		expect(calls[0]?.signal.aborted).toBe(true);
		const detail = await engine.getRun(run.id);
		expect(detail.status).toBe("stopped");
		expect(detail.steps[0]?.outcome).toBe("stopped");
	});
});

/** worker → gate; approve → shipper; reject → worker (max 2). */
function gateFlow(): Flow {
	return flowOf(
		[
			agent("worker", "Build it. {{gate.note}}"),
			gate("gate", "The worker said: {{worker.summary}}. Ship it?", [
				"approve",
				"reject",
			]),
			agent("shipper", "Ship it. Reviewer: {{gate.note}}"),
		],
		[
			edge("e1", "worker", "pass", "gate"),
			edge("e2", "gate", "approve", "shipper"),
			edge("e3", "gate", "reject", "worker", 2),
		],
	);
}

async function openGateOf(engine: Engine, runId: string) {
	return waitFor(
		async () => (await engine.listGates()).find((g) => g.runId === runId),
		{ label: "an open gate" },
	);
}

describe("gates", () => {
	test("a gate waits without a slot, and its answer continues the walk", async () => {
		const harness = fakeHarness((_input, call) =>
			call === 0 ? reportingScript("pass", "Built the parser.") : {},
		);
		const engine = makeEngine(harness, { maxConcurrentRuns: 1 });
		const id = await projectId(engine);
		const run = await engine.startRun({ projectId: id, flow: gateFlow() });
		await waitForStatus(engine, run.id, "waiting");

		const gates = await engine.listGates();
		expect(gates).toHaveLength(1);
		const open = gates[0];
		expect(open).toMatchObject({
			runId: run.id,
			runTitle: run.title,
			projectId: id,
			projectName: "repo",
			nodeId: "gate",
			question: "The worker said: Built the parser.. Ship it?",
			choices: [{ name: "approve" }, { name: "reject" }],
		});
		let detail = await engine.getRun(run.id);
		expect(detail.steps.at(-1)).toMatchObject({
			id: open?.stepId,
			nodeType: "gate",
			outcome: null,
			endedAt: null,
		});
		expect(open?.openedAt).toBeGreaterThanOrEqual(
			detail.steps[1]?.startedAt ?? Number.POSITIVE_INFINITY,
		);

		// The waiting run holds no slot: another run starts with a cap of 1.
		const other = await engine.startRun({
			projectId: id,
			flow: flowOf([agent("solo", "Go")]),
		});
		expect(await waitForEnd(engine, other.id)).toBe("finished");

		await engine.resolveGate({
			runId: run.id,
			stepId: open?.stepId ?? "",
			choice: "approve",
			note: "LGTM, merge after CI.",
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(await engine.listGates()).toEqual([]);
		expect(harness.calls.at(-1)?.prompt).toBe(
			"Ship it. Reviewer: LGTM, merge after CI.",
		);
		detail = await engine.getRun(run.id);
		expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["worker", "pass"],
			["gate", "approve"],
			["shipper", "pass"],
		]);
		expect(detail.steps[1]?.outputs).toEqual({
			outcome: "approve",
			note: "LGTM, merge after CI.",
			visit: 1,
		});
		expect(detail.traversals).toEqual({ e1: 1, e2: 1 });
		expect(
			(await stepEntries(run.id, open?.stepId)).map((e) => e.event),
		).toEqual([
			{
				type: "gate-open",
				question: "The worker said: Built the parser.. Ship it?",
				choices: [{ name: "approve" }, { name: "reject" }],
			},
			{
				type: "gate-resolved",
				choice: "approve",
				note: "LGTM, merge after CI.",
			},
		]);
	});

	test("watchRun reports the wait and the answer", async () => {
		const engine = makeEngine(fakeHarness());
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: gateFlow(),
		});
		const watching = collect(engine, run.id, isStatus("finished"));
		const open = await openGateOf(engine, run.id);
		await engine.resolveGate({
			runId: run.id,
			stepId: open.stepId,
			choice: "approve",
		});
		const items = await watching;
		const statuses = statusesOf(items);
		expect(statuses).toContain("waiting");
		expect(statuses.slice(statuses.indexOf("waiting"))).toEqual([
			"waiting",
			"running",
			"finished",
		]);
		const gateSteps = items.flatMap((i) =>
			i.kind === "step" && i.step.nodeId === "gate" ? [i.step] : [],
		);
		expect(gateSteps.some((s) => s.outcome === null)).toBe(true);
		expect(gateSteps.at(-1)).toMatchObject({
			outcome: "approve",
			outputs: { note: "" },
		});
		expect(
			entriesOf(items)
				.map((e) => e.event.type)
				.filter((t) => t.startsWith("gate")),
		).toEqual(["gate-open", "gate-resolved"]);
	});

	test("resolveGate rejects a wrong step, a wrong choice and a run that does not wait", async () => {
		const engine = makeEngine(fakeHarness());
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: gateFlow(),
		});
		const open = await openGateOf(engine, run.id);
		const workerStep = (await engine.getRun(run.id)).steps[0]?.id ?? "";

		await expect(
			engine.resolveGate({ runId: run.id, stepId: open.stepId, choice: "yes" }),
		).rejects.toThrow(
			'"yes" is not a choice of this Gate. Choose one of: approve, reject.',
		);
		await expect(
			engine.resolveGate({
				runId: run.id,
				stepId: workerStep,
				choice: "approve",
			}),
		).rejects.toThrow("is not the open Gate of this run");
		await expect(
			engine.resolveGate({
				runId: "missing",
				stepId: open.stepId,
				choice: "approve",
			}),
		).rejects.toThrow("Run not found");
		await expect(engine.resumeRun(run.id)).rejects.toThrow("waits at a Gate");
		expect(await statusOf(engine, run.id)).toBe("waiting");

		await engine.resolveGate({
			runId: run.id,
			stepId: open.stepId,
			choice: "approve",
		});
		await expect(
			engine.resolveGate({
				runId: run.id,
				stepId: open.stepId,
				choice: "approve",
			}),
		).rejects.toThrow();
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		await expect(
			engine.resolveGate({
				runId: run.id,
				stepId: open.stepId,
				choice: "reject",
			}),
		).rejects.toThrow("does not wait at a Gate");
	});

	test("an answer while the run cap is full fails and keeps the gate open", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness, { maxConcurrentRuns: 1 });
		const id = await projectId(engine);
		const run = await engine.startRun({
			projectId: id,
			flow: flowOf(
				[gate("gate", "Go?", ["go"]), command("done", "true")],
				[edge("e1", "gate", "go", "done")],
			),
		});
		const open = await openGateOf(engine, run.id);
		const busy = await engine.startRun({
			projectId: id,
			flow: flowOf([agent("solo", "Go")]),
		});
		await waitFor(() => sessions[0]);

		await expect(
			engine.resolveGate({ runId: run.id, stepId: open.stepId, choice: "go" }),
		).rejects.toThrow("The run cap is reached: 1 of 1");
		expect(await statusOf(engine, run.id)).toBe("waiting");
		expect(await engine.listGates()).toHaveLength(1);

		sessions[0]?.finish();
		await waitForStatus(engine, busy.id, "finished");
		await engine.resolveGate({
			runId: run.id,
			stepId: open.stepId,
			choice: "go",
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
	});

	test("a gate stays open across a daemon restart and can be answered there", async () => {
		const first = makeEngine(fakeHarness());
		const id = await projectId(first);
		const run = await first.startRun({ projectId: id, flow: gateFlow() });
		const open = await openGateOf(first, run.id);

		// A new daemon on the same database and data directory.
		const harness = fakeHarness();
		const second = makeEngine(harness);
		expect(await statusOf(second, run.id)).toBe("waiting");
		expect(await second.listGates()).toEqual([open]);
		const detail = await second.getRun(run.id);
		expect(detail.steps.at(-1)?.outcome).toBeNull();
		expect(await loggedTypes()).not.toContain("RunEnded");

		await second.resolveGate({
			runId: run.id,
			stepId: open.stepId,
			choice: "reject",
			note: "Add tests.",
		});
		await waitForStatus(second, run.id, "waiting");
		expect(harness.calls[0]?.prompt).toBe("Build it. Add tests.");
		const again = await openGateOf(second, run.id);
		expect(again.stepId).not.toBe(open.stepId);

		// The seq keeps counting across the restart.
		const items = await collect(second, run.id, (_i, all) =>
			entriesOf(all).some(
				(e) => e.event.type === "gate-open" && e.stepId === again.stepId,
			),
		);
		const seqs = entriesOf(items).map((e) => e.seq);
		expect(seqs).toEqual(seqs.map((_, i) => i + 1));
	});

	test("a project with a waiting gate cannot be removed", async () => {
		const engine = makeEngine(fakeHarness());
		const id = await projectId(engine);
		const run = await engine.startRun({ projectId: id, flow: gateFlow() });
		await openGateOf(engine, run.id);
		await expect(engine.removeProject(id)).rejects.toThrow("waits at a Gate");
		await engine.stopRun(run.id);
		await engine.removeProject(id);
		expect(await engine.listGates()).toEqual([]);
	});

	test("stop closes a waiting gate, and resume asks again", async () => {
		const harness = fakeHarness((_input, call) =>
			reportingScript("pass", `summary ${call + 1}`),
		);
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: gateFlow(),
		});
		const open = await openGateOf(engine, run.id);

		await engine.stopRun(run.id);
		let detail = await engine.getRun(run.id);
		expect(detail.status).toBe("stopped");
		expect(detail.reason).toBeNull();
		expect(detail.steps.at(-1)).toMatchObject({
			id: open.stepId,
			outcome: "stopped",
			outputs: { outcome: "stopped", note: "", visit: 1 },
		});
		expect(await engine.listGates()).toEqual([]);
		expect(await loggedTypes()).toContain("StopRequested");
		await expect(
			engine.resolveGate({
				runId: run.id,
				stepId: open.stepId,
				choice: "approve",
			}),
		).rejects.toThrow("does not wait at a Gate");
		// Stopping again is a no-op.
		await engine.stopRun(run.id);

		await engine.resumeRun(run.id);
		const reopened = await openGateOf(engine, run.id);
		expect(reopened.stepId).not.toBe(open.stepId);
		expect(reopened.question).toBe(open.question);
		detail = await engine.getRun(run.id);
		expect(detail.status).toBe("waiting");
		expect(detail.steps.map((s) => [s.nodeId, s.visit, s.outcome])).toEqual([
			["worker", 1, "pass"],
			["gate", 1, "stopped"],
			["gate", 2, null],
		]);
		await engine.resolveGate({
			runId: run.id,
			stepId: reopened.stepId,
			choice: "approve",
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
	});
});

describe("a full flow", () => {
	test("worker → decide → gate → worker loops until its max, then resumes at the gate", async () => {
		const harness = fakeHarness((_input, call) =>
			reportingScript("pass", `attempt ${call + 1}`),
		);
		const answers = ["retry", "review", "review"];
		const { decider, calls } = scriptedDecider((_input, call) =>
			decided(answers[call] ?? "review", `call ${call + 1}`, 0.01),
		);
		const engine = makeEngine(harness, { decider, maxConcurrentRuns: 1 });
		const flow = flowOf(
			[
				agent("worker", "Build it. Reviewer: {{gate.note}}", {
					tools: ["github"],
				}),
				decision("decide", "Worker: {{worker.summary}}. Review it?", [
					"retry",
					"review",
				]),
				gate("gate", "{{worker.summary}} ({{decide.notes}}). Ship it?", [
					"approve",
					"rework",
				]),
				command("ship", 'echo "shipped: {{gate.note}}"'),
			],
			[
				edge("built", "worker", "pass", "decide"),
				edge("retry", "decide", "retry", "worker", 2),
				edge("review", "decide", "review", "gate"),
				edge("rework", "gate", "rework", "worker", 1),
				edge("approve", "gate", "approve", "ship"),
			],
		);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow,
		});

		const first = await openGateOf(engine, run.id);
		expect(first.question).toBe("attempt 2 (call 2). Ship it?");
		await engine.resolveGate({
			runId: run.id,
			stepId: first.stepId,
			choice: "rework",
			note: "Add tests.",
		});
		await waitFor(
			async () => (await engine.getRun(run.id)).steps.length === 8,
			{ label: "the second gate" },
		);
		const second = await openGateOf(engine, run.id);
		expect(second.question).toBe("attempt 3 (call 3). Ship it?");

		// The rework edge has a max of 1: a second rework fails the run.
		await engine.resolveGate({
			runId: run.id,
			stepId: second.stepId,
			choice: "rework",
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		let detail = await engine.getRun(run.id);
		expect(detail.reason).toContain('"rework"');
		expect(detail.reason).toContain("max 1");

		// Resume asks the gate again; this time it ships.
		await engine.resumeRun(run.id);
		const third = await openGateOf(engine, run.id);
		await engine.resolveGate({
			runId: run.id,
			stepId: third.stepId,
			choice: "approve",
			note: "ok",
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");

		detail = await engine.getRun(run.id);
		expect(detail.steps.map((s) => [s.nodeId, s.visit, s.outcome])).toEqual([
			["worker", 1, "pass"],
			["decide", 1, "retry"],
			["worker", 2, "pass"],
			["decide", 2, "review"],
			["gate", 1, "rework"],
			["worker", 3, "pass"],
			["decide", 3, "review"],
			["gate", 2, "rework"],
			["gate", 3, "approve"],
			["ship", 1, "pass"],
		]);
		expect(detail.traversals).toEqual({
			built: 3,
			retry: 1,
			review: 2,
			rework: 1,
			approve: 1,
		});
		expect(detail.steps.at(-1)?.outputs.log_tail).toBe("shipped: ok");
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			"Build it. Reviewer: ",
			"Build it. Reviewer: ",
			"Build it. Reviewer: Add tests.",
		]);
		expect(harness.calls.every((c) => c.tools?.join() === "github")).toBe(true);
		expect(calls.map((c) => c.prompt)).toEqual([
			"Worker: attempt 1. Review it?",
			"Worker: attempt 2. Review it?",
			"Worker: attempt 3. Review it?",
		]);
		expect(detail.costUsd).toBeCloseTo(sessionCostOf(detail) + 0.03);
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
