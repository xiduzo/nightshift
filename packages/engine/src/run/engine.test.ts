import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { defaultDeciderModel } from "@nightshift/agents";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import type {
	AgentHarness,
	Decider,
	DecisionInput,
	DecisionResult,
} from "@nightshift/agents/types";
import { event, lgCheckpoint, lgWrite, run, step } from "@nightshift/db/schema";
import {
	type AgentNode,
	type CommandNode,
	type DecisionNode,
	type Flow,
	type FlowEdge,
	singleAgentFlow,
	type WaitNode,
} from "@nightshift/flows";
import { asc, eq } from "drizzle-orm";
import {
	defaultRunSettings,
	type RunSettings,
} from "../device-config/settings";
import type { RunStatus } from "../log/events";
import { createRunLog, type RunLog } from "../log/run-log";
import type { TranscriptEntry } from "../log/step-events";
import type { RunDetail, RunStreamItem } from "../read/views";
import {
	createSandbox,
	expectRunLogsInSync,
	mustGit,
	type Sandbox,
	scriptedHarness,
	sleepClock,
	type TestEngineOptions,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { GateClosedError } from "./actions";
import type { Engine } from "./engine";
import { createEngine, type EngineInternals } from "./engine";
import type { SpaceEngine } from "./space-engine";

let sandbox: Sandbox;
/** The run log of each engine the test made, oldest first: checked against the database after it. */
let runLogs: RunLog[];
beforeEach(async () => {
	sandbox = await createSandbox();
	runLogs = [];
});
afterEach(async () => {
	try {
		await expectRunLogsInSync(sandbox.db, runLogs);
	} finally {
		await sandbox.cleanup();
	}
});

function makeEngine(
	harness: AgentHarness,
	options: Pick<
		TestEngineOptions,
		| "maxConcurrentRuns"
		| "maxStepsPerRun"
		| "decider"
		| "settings"
		| "scheduler"
		| "cliNames"
		| "findCli"
	> = {},
	internals: EngineInternals = {},
): SpaceEngine {
	return makeDaemon(harness, options, internals).space(sandbox.spaceId);
}

/** The whole engine of a daemon, for what it does outside a Space. */
function makeDaemon(
	harness: AgentHarness,
	options: Parameters<typeof makeEngine>[1] = {},
	internals: EngineInternals = {},
): Engine {
	const runLog = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
	runLogs.push(runLog);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": harness },
			// This computer: the Walker places every step on itself.
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			...options,
		}),
		{ runLog, ...internals },
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
	return {
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: cmd,
		output: "text",
	};
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
	return {
		version: 5,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges,
	};
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

async function projectId(engine: SpaceEngine): Promise<string> {
	return (await engine.addProject({ repoPath: sandbox.repoPath })).id;
}

async function statusOf(
	engine: SpaceEngine,
	runId: string,
): Promise<RunStatus> {
	return (await engine.getRun(runId)).status;
}

async function waitForStatus(
	engine: SpaceEngine,
	runId: string,
	status: RunStatus,
) {
	await waitFor(async () => (await statusOf(engine, runId)) === status, {
		label: `status ${status}`,
	});
}

async function waitForEnd(
	engine: SpaceEngine,
	runId: string,
): Promise<RunStatus> {
	return waitFor(
		async () => {
			const status = await statusOf(engine, runId);
			return status === "running" ? null : status;
		},
		{ label: "the run to end" },
	);
}

/**
 * Runs `fn` while no timer can fire: `setTimeout` and `setInterval` take
 * the callback and drop it, as in a daemon whose timers stopped.
 */
async function withFrozenTimers<T>(fn: () => Promise<T>): Promise<T> {
	const { setTimeout: timeout, setInterval: interval } = globalThis;
	const never = (() => ({
		ref() {},
		unref() {},
		hasRef: () => false,
		refresh() {},
	})) as unknown;
	globalThis.setTimeout = never as typeof setTimeout;
	globalThis.setInterval = never as typeof setInterval;
	try {
		return await fn();
	} finally {
		globalThis.setTimeout = timeout;
		globalThis.setInterval = interval;
	}
}

async function loggedTypes(): Promise<string[]> {
	const rows = await sandbox.db.select().from(event).orderBy(asc(event.seq));
	return rows.map((r) => r.type);
}

/** Watches a run until `until` says stop, and returns every item. */
async function collect(
	engine: SpaceEngine,
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
/**
 * Until the run has the status and `whole` says its transcript is in.
 * The transcript has its own reader, so its last entries may come after
 * the status: a watch keeps going after a run ends.
 */
const endedWith =
	(status: RunStatus, whole: (entries: TranscriptEntry[]) => boolean) =>
	(_item: RunStreamItem, items: RunStreamItem[]) =>
		statusesOf(items).includes(status) && whole(entriesOf(items));

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
			"is not a git repository",
		);
		expect(await engine.listProjects()).toEqual([]);
	});

	test("a project without commits refuses to start a run", async () => {
		const engine = makeEngine(scriptedHarness().harness);
		const empty = join(sandbox.root, "empty");
		await mkdir(empty);
		await mustGit(empty, ["init", "-q"]);
		const project = await engine.addProject({ repoPath: empty });
		await expect(
			engine.startRun({
				projectId: project.id,
				flow: singleAgentFlow({
					prompt: "Do it",
					model: "sonnet",
					permissionMode: "default",
				}),
			}),
		).rejects.toThrow("The project has no commits yet.");
		expect(await engine.listRuns()).toEqual([]);
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
		await expect(engine.listFlows(id)).rejects.toThrow(
			"Night Shift cannot find this project.",
		);
		await expect(
			engine.startRun({ projectId: id, flowName: "anything" }),
		).rejects.toThrow("Night Shift cannot find this project.");

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

	test("this computer walks the run: the run and its events name the Walker, each step the Device it ran on", async () => {
		const engine = makeEngine(fakeHarness());
		const { id: runId } = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([command("check", "true")]),
		});
		expect(await waitForEnd(engine, runId)).toBe("finished");

		const [runRow] = await sandbox.db
			.select({ walkerId: run.walkerId })
			.from(run)
			.where(eq(run.id, runId));
		expect(runRow?.walkerId).toBe(sandbox.deviceId);
		const steps = await sandbox.db
			.select({ deviceId: step.deviceId })
			.from(step)
			.where(eq(step.runId, runId));
		expect(steps.length).toBeGreaterThan(0);
		expect(steps.every((s) => s.deviceId === sandbox.deviceId)).toBe(true);
		const events = await sandbox.db
			.select({ walkerId: event.walkerId, walkerSeq: event.walkerSeq })
			.from(event)
			.orderBy(asc(event.seq));
		expect(events.every((e) => e.walkerId === sandbox.deviceId)).toBe(true);
		expect(events.map((e) => e.walkerSeq)).toEqual(events.map((_, i) => i + 1));
	});

	test("a finished run keeps its latest checkpoint only; a resume re-enters on it and continues the last session", async () => {
		const harness = fakeHarness(reportingScript("pass", "Done"));
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", "Go")]),
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		const checkpoints = async () =>
			(
				await sandbox.db
					.select()
					.from(lgCheckpoint)
					.where(eq(lgCheckpoint.threadId, run.id))
			).length;
		const writes = async () =>
			(
				await sandbox.db
					.select()
					.from(lgWrite)
					.where(eq(lgWrite.threadId, run.id))
			).length;
		// The log is the record; the thread's history goes, its final state stays.
		await waitFor(async () => (await checkpoints()) === 1, {
			label: "the checkpoints to be pruned",
		});
		expect(await writes()).toBe(0);

		// A resume re-enters the thread on that checkpoint at the last step,
		// continuing its harness session with the person's prompt.
		await engine.resumeRun(run.id, "Once more.");
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(harness.calls).toHaveLength(2);
		expect(harness.calls[1]).toMatchObject({
			prompt: "Once more.",
			resumeSessionId: "fake-session-1",
		});
		const detail = await engine.getRun(run.id);
		expect(detail.steps.map((s) => [s.nodeId, s.visit, s.outcome])).toEqual([
			["worker", 1, "pass"],
		]);
		expect(detail.steps[0]?.sessions).toHaveLength(2);
		await waitFor(async () => (await checkpoints()) === 1, {
			label: "the checkpoints to be pruned again",
		});
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
	test("stop ends a run the log says runs when its drive could not log the end", async () => {
		// The run log fails the first RunEnded: the drive ends, the run does not.
		const inner = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
		runLogs.push(inner);
		let failed = false;
		const runLog: RunLog = {
			...inner,
			async append(e, writes) {
				if (e.type === "RunEnded" && !failed) {
					failed = true;
					throw new Error("The disk is full.");
				}
				return inner.append(e, writes);
			},
		};
		const engine = makeEngine(scriptedHarness().harness, {}, { runLog });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([command("check", "true")]),
		});
		await waitFor(
			async () =>
				failed && (await engine.getRun(run.id)).steps[0]?.outcome === "pass",
			{ label: "the drive to end without its RunEnded" },
		);
		expect(await statusOf(engine, run.id)).toBe("running");

		await engine.stopRun(run.id);
		expect(await statusOf(engine, run.id)).toBe("stopped");
		// It goes on as any stopped run does.
		await engine.resumeRun(run.id);
		expect(await waitForEnd(engine, run.id)).toBe("finished");
	});

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

	test("stop ends a step whose harness hangs at once, with no timer, and the late drive writes nothing", async () => {
		// The session never says a word after it is ready and ignores the abort.
		const { harness, sessions } = scriptedHarness({ hang: true, silent: true });
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					agent("worker", "Build it", { timeoutMinutes: 60, idleMinutes: 30 }),
					command("check", "echo ok"),
				],
				[edge("e1", "worker", "pass", "check")],
			),
		});
		const hung = await waitFor(() => sessions[0]);

		await withFrozenTimers(() => engine.stopRun(run.id));
		expect(hung.input.signal.aborted).toBe(true);
		const detail = await engine.getRun(run.id);
		expect(detail.status).toBe("stopped");
		expect(detail.reason).toBeNull();
		expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["worker", "stopped"],
		]);
		expect(detail.steps[0]?.sessions[0]?.outcome).toBe("stopped");
		const stopped = await loggedTypes();
		expect(stopped.slice(-4)).toEqual([
			"StopRequested",
			"SessionEnded",
			"StepEnded",
			"RunEnded",
		]);

		// The hung drive wakes up much later: the stop took the run from it.
		hung.emit({ type: "session", sessionId: "late", model: "sonnet" });
		hung.text("too late");
		hung.finish(1);
		await Bun.sleep(100);
		expect(await loggedTypes()).toEqual(stopped);
		expect(await statusOf(engine, run.id)).toBe("stopped");
	});

	test("a resume after a stop drives anew while the stopped drive still hangs", async () => {
		const { harness, sessions } = scriptedHarness({ hang: true, silent: true });
		const engine = makeEngine(harness, { maxConcurrentRuns: 1 });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[agent("worker", "Build it"), command("check", "echo ok")],
				[edge("e1", "worker", "pass", "check")],
			),
		});
		const hung = await waitFor(() => sessions[0]);
		await withFrozenTimers(() => engine.stopRun(run.id));

		// The stopped drive holds no slot: the cap of one lets the resume in.
		await engine.resumeRun(run.id);
		const second = await waitFor(() => sessions[1], { label: "resume" });
		expect(second.input.signal.aborted).toBe(false);
		await expect(engine.resumeRun(run.id)).rejects.toThrow("still running");

		// The old drive wakes while the new one runs: it writes nothing, and
		// it does not touch the new drive's thread.
		const before = await loggedTypes();
		hung.emit({ type: "session", sessionId: "late", model: "sonnet" });
		hung.finish(1);
		await Bun.sleep(100);
		expect(await loggedTypes()).toEqual(before);
		expect(await statusOf(engine, run.id)).toBe("running");

		second.emit({ type: "session", sessionId: "fresh", model: "sonnet" });
		second.finish(0.25);
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		const detail = await engine.getRun(run.id);
		expect(detail.steps.map((s) => [s.nodeId, s.visit, s.outcome])).toEqual([
			["worker", 1, "stopped"],
			["worker", 2, "pass"],
			["check", 1, "pass"],
		]);
		expect(detail.costUsd).toBeCloseTo(0.25);
		const types = await loggedTypes();
		expect(types.filter((t) => t === "RunEnded")).toHaveLength(2);
		expect(types.filter((t) => t === "EdgeTaken")).toHaveLength(1);
	});

	test.each([
		[
			"a resume",
			(engine: SpaceEngine, runId: string) => engine.resumeRun(runId),
		],
		[
			"a rerun",
			(engine: SpaceEngine, runId: string) =>
				engine.rerunFrom(runId, { nodeId: "worker" }),
		],
	])(
		"a stop that comes while %s begins is not lost: it stops the new walk",
		async (_name, reenter) => {
			// The log holds `RunResumed` back until the test lets it go: the
			// re-entry is half done when the stop comes.
			const inner = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
			runLogs.push(inner);
			let release = () => {};
			let held: Promise<void> | null = null;
			const runLog: RunLog = {
				...inner,
				async append(input, writes) {
					if (input.type === "RunResumed" && held === null) {
						held = new Promise<void>((resolve) => {
							release = resolve;
						});
						await held;
					}
					return inner.append(input, writes);
				},
			};
			const { harness, sessions } = scriptedHarness();
			const engine = makeDaemon(harness, {}, { runLog }).space(sandbox.spaceId);
			const run = await engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf(
					[agent("worker", "Build it"), command("check", "echo ok")],
					[edge("e1", "worker", "pass", "check")],
				),
			});
			await waitFor(() => sessions[0]);
			await engine.stopRun(run.id);

			const reentering = reenter(engine, run.id);
			await waitFor(() => held !== null);
			const stopping = engine.stopRun(run.id);
			await Bun.sleep(20);
			release();
			await reentering;
			await stopping;

			expect(await statusOf(engine, run.id)).toBe("stopped");
			const resumed = sessions[1];
			if (resumed) expect(resumed.input.signal.aborted).toBe(true);
			const types = await loggedTypes();
			expect(types.filter((t) => t === "StopRequested")).toHaveLength(2);
			expect(types.at(-1)).toBe("RunEnded");
		},
	);

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

describe("restart a step", () => {
	test("a session that hangs after its work restarts in one action: the old one is aborted and fenced, the same session continues", async () => {
		// The incident: the agent is done, but its session never ends and
		// ignores the abort.
		const { harness, sessions } = scriptedHarness({ hang: true });
		const engine = makeEngine(harness, { maxConcurrentRuns: 1 });
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[agent("worker", "Build it"), command("check", "echo ok")],
				[edge("e1", "worker", "pass", "check")],
			),
		});
		const hung = await waitFor(() => sessions[0]);
		hung.text("All done.");
		await waitFor(async () =>
			(await engine.getRun(run.id)).steps[0]?.sessions[0]?.harnessSessionId
				? true
				: null,
		);

		// The run cap of one: the restart keeps the run's slot.
		await engine.restartStep(run.id, { prompt: "Report your result now." });
		expect(hung.input.signal.aborted).toBe(true);
		const second = await waitFor(() => sessions[1], { label: "restart" });
		expect(second.input.resumeSessionId).toBe("harness-0");
		expect(second.input.prompt).toBe("Report your result now.");
		expect(second.input.signal.aborted).toBe(false);
		expect(await statusOf(engine, run.id)).toBe("running");
		const types = await loggedTypes();
		const at = types.lastIndexOf("StopRequested");
		expect(types.slice(at, at + 6)).toEqual([
			"StopRequested",
			"SessionEnded",
			"StepEnded",
			"RunEnded",
			"RunResumed",
			"StepReopened",
		]);

		// The old session ends much later: it writes nothing.
		const before = await loggedTypes();
		hung.finish(1);
		await Bun.sleep(100);
		expect(await loggedTypes()).toEqual(before);

		second.finish(0.25);
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		const detail = await engine.getRun(run.id);
		expect(detail.steps.map((s) => [s.nodeId, s.visit, s.outcome])).toEqual([
			["worker", 1, "pass"],
			["check", 1, "pass"],
		]);
		expect(detail.steps[0]?.sessions.map((s) => s.outcome)).toEqual([
			"stopped",
			"finished",
		]);
		expect(detail.resumes).toEqual([
			{
				at: expect.any(Number),
				by: "person",
				nodeId: "worker",
				reason: null,
				action: "restart",
			},
		]);
		expect(detail.costUsd).toBeCloseTo(0.25);
	});

	test("without a prompt, the restart uses Resume's follow-up; a step with no session runs again", async () => {
		const { harness, sessions } = scriptedHarness({ hang: true, silent: true });
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", "Build it")]),
		});
		const hung = await waitFor(() => sessions[0]);
		await engine.restartStep(run.id);
		expect(hung.input.signal.aborted).toBe(true);
		const second = await waitFor(() => sessions[1], { label: "restart" });
		// The harness never named its session: nothing to continue.
		expect(second.input.resumeSessionId).toBeUndefined();
		expect(second.input.prompt).toBe("Build it");
		second.emit({ type: "session", sessionId: "s2", model: "sonnet" });
		second.finish();
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(
			(await engine.getRun(run.id)).steps.map((s) => [s.visit, s.outcome]),
		).toEqual([
			[1, "stopped"],
			[2, "pass"],
		]);

		const { harness: h2, sessions: s2 } = scriptedHarness({ hang: true });
		const other = makeEngine(h2);
		const run2 = await other.startRun({
			projectId: await projectId(other),
			flow: flowOf([agent("worker", "Build it")]),
		});
		await waitFor(() => s2[0]);
		await waitFor(async () =>
			(await other.getRun(run2.id)).steps[0]?.sessions[0]?.harnessSessionId
				? true
				: null,
		);
		await other.restartStep(run2.id);
		const again = await waitFor(() => s2[1], { label: "restart" });
		expect(again.input.prompt).toBe("Continue where you left off.");
		expect(again.input.resumeSessionId).toBe("harness-0");
		again.finish();
		expect(await waitForEnd(other, run2.id)).toBe("finished");
	});

	test("a restart racing a session that ends: one of them wins, and the log stays whole", async () => {
		for (const delay of [-1, 0, 1, 5, 20]) {
			const { harness, sessions } = scriptedHarness();
			const engine = makeEngine(harness);
			const run = await engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf([agent("worker", "Build it")]),
			});
			const first = await waitFor(() => sessions[0]);
			await waitFor(async () =>
				(await engine.getRun(run.id)).steps[0]?.sessions[0]?.harnessSessionId
					? true
					: null,
			);
			first.finish(0.5);
			if (delay >= 0) await Bun.sleep(delay);
			const restarted = await engine.restartStep(run.id).then(
				() => true,
				(error: Error) => error.message,
			);
			if (restarted === true) {
				const second = await waitFor(() => sessions[1], {
					label: `the restart after ${delay} ms`,
				});
				second.finish(0.25);
			} else {
				// The session ended first: its step ended, or the run did too.
				// Nothing is left to restart.
				expect(restarted).toMatch(
					/has ended|ended before it could restart|No step runs right now/,
				);
				expect(sessions).toHaveLength(1);
			}
			expect(await waitForEnd(engine, run.id)).toBe("finished");
			const detail = await engine.getRun(run.id);
			expect(detail.steps).toHaveLength(1);
			expect(detail.steps[0]?.outcome).toBe("pass");
			const types = (
				await sandbox.db
					.select()
					.from(event)
					.where(eq(event.runId, run.id))
					.orderBy(asc(event.seq))
			).map((e) => e.type);
			// Every opening of the step ends once, every session ends once,
			// and the run ends once per walk.
			const count = (type: string) => types.filter((t) => t === type).length;
			expect(count("StepEnded")).toBe(
				count("StepStarted") + count("StepReopened"),
			);
			expect(count("SessionEnded")).toBe(count("SessionStarted"));
			expect(count("RunEnded")).toBe(1 + count("RunResumed"));
			expect(count("RunResumed")).toBe(restarted === true ? 1 : 0);
		}
	});

	test("a restart for a step that ended meanwhile is refused, and the run goes on", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[agent("worker", "Build it"), agent("reviewer", "Review it")],
				[edge("e1", "worker", "pass", "reviewer")],
			),
		});
		(await waitFor(() => sessions[0])).finish();
		const second = await waitFor(() => sessions[1]);
		const workerStep = (await engine.getRun(run.id)).steps[0];
		await expect(
			engine.restartStep(run.id, { stepId: workerStep?.id ?? "" }),
		).rejects.toThrow("That step has ended");
		expect(second.input.signal.aborted).toBe(false);
		expect(await statusOf(engine, run.id)).toBe("running");
		second.finish();
		expect(await waitForEnd(engine, run.id)).toBe("finished");
	});

	test("refusals: a run that ended, a run that waits at a Gate, a run another device walks", async () => {
		const harness = fakeHarness((_input, call) =>
			reportingScript("pass", `summary ${call + 1}`),
		);
		const engine = makeEngine(harness);
		const walked = await engine.startRun({
			projectId: await projectId(engine),
			flow: gateFlow(),
		});
		await openGateOf(engine, walked.id);
		await expect(engine.restartStep(walked.id)).rejects.toThrow(
			"This run waits at a Gate",
		);
		await engine.stopRun(walked.id);
		await expect(engine.restartStep(walked.id)).rejects.toThrow(
			"This run has ended",
		);
		const before = await loggedTypes();

		await sandbox.db
			.update(run)
			.set({ walkerId: "another-device" })
			.where(eq(run.id, walked.id));
		// One rule, one refusal: only the Walker resumes, restarts or reruns.
		for (const act of [
			() => engine.resumeRun(walked.id),
			() => engine.restartStep(walked.id),
			() => engine.rerunFrom(walked.id, { nodeId: "worker" }),
		]) {
			await expect(act()).rejects.toThrow(
				"Another device runs this run. Try again on that device.",
			);
		}
		expect(await loggedTypes()).toEqual(before);
	});
});

describe("run again from a step", () => {
	test("after a failed run, from an earlier agent step: a new visit continues its session with the prompt, and the steps after it run again", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[agent("worker", "Build it"), command("check", passOnAttempt(2))],
				[edge("e1", "worker", "pass", "check")],
			),
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");

		await engine.rerunFrom(run.id, {
			nodeId: "worker",
			prompt: "The check failed. Fix it.",
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(
			harness.calls.map((c) => [c.prompt, c.resumeSessionId ?? null]),
		).toEqual([
			["Build it", null],
			["The check failed. Fix it.", "fake-session-1"],
		]);
		const detail = await engine.getRun(run.id);
		expect(detail.steps.map((s) => [s.nodeId, s.visit, s.outcome])).toEqual([
			["worker", 1, "pass"],
			["check", 1, "fail"],
			["worker", 2, "pass"],
			["check", 2, "pass"],
		]);
		expect(detail.reason).toBeNull();
		expect(detail.traversals).toEqual({ e1: 2 });
		expect(detail.resumes).toEqual([
			{
				at: expect.any(Number),
				by: "person",
				nodeId: "worker",
				reason: null,
				action: "rerun",
			},
		]);
	});

	test("start fresh: the agent starts a new session with the flow's prompt, also on a node that resumes its session", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					agent("worker", "Build it", { session: "resume" }),
					command("check", passOnAttempt(2)),
				],
				[edge("e1", "worker", "pass", "check")],
			),
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		await engine.rerunFrom(run.id, {
			nodeId: "worker",
			prompt: "ignored",
			fresh: true,
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(
			harness.calls.map((c) => [c.prompt, c.resumeSessionId ?? null]),
		).toEqual([
			["Build it", null],
			["Build it", null],
		]);
	});

	test("after a finished run, from its first step: every step runs again and the run finishes", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[command("prepare", "echo ready"), agent("worker", "Build it")],
				[edge("e1", "prepare", "pass", "worker")],
			),
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");

		await engine.rerunFrom(run.id, { nodeId: "prepare" });
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		// The agent after it runs as its node says: a fresh session.
		expect(
			harness.calls.map((c) => [c.prompt, c.resumeSessionId ?? null]),
		).toEqual([
			["Build it", null],
			["Build it", null],
		]);
		const detail = await engine.getRun(run.id);
		expect(detail.steps.map((s) => [s.nodeId, s.visit, s.outcome])).toEqual([
			["prepare", 1, "pass"],
			["worker", 1, "pass"],
			["prepare", 2, "pass"],
			["worker", 2, "pass"],
		]);
		expect(detail.traversals).toEqual({ e1: 2 });
		await waitFor(
			async () =>
				(
					await sandbox.db
						.select()
						.from(lgCheckpoint)
						.where(eq(lgCheckpoint.threadId, run.id))
				).length === 1,
			{ label: "the checkpoints to be pruned again" },
		);
	});

	test("after a stop in the middle of a step, only the chosen step runs: the cut-short one is not taken up", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[command("prepare", "echo ready"), agent("worker", "Build it")],
				[edge("e1", "prepare", "pass", "worker")],
			),
		});
		await waitFor(() => sessions[0]);
		await engine.stopRun(run.id);

		await engine.rerunFrom(run.id, { nodeId: "prepare" });
		const second = await waitFor(() => sessions[1], { label: "the rerun" });
		// A new visit with a fresh session: the stopped one stays stopped.
		expect(second.input.resumeSessionId).toBeUndefined();
		second.finish();
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(sessions).toHaveLength(2);
		expect(
			(await engine.getRun(run.id)).steps.map((s) => [
				s.nodeId,
				s.visit,
				s.outcome,
			]),
		).toEqual([
			["prepare", 1, "pass"],
			["worker", 1, "stopped"],
			["prepare", 2, "pass"],
			["worker", 2, "pass"],
		]);
	});

	test("after a stop at a Gate, from the agent before it: the Gate asks once more, not twice", async () => {
		const harness = fakeHarness((_input, call) =>
			reportingScript("pass", `summary ${call + 1}`),
		);
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: gateFlow(),
		});
		await openGateOf(engine, run.id);
		await engine.stopRun(run.id);

		await engine.rerunFrom(run.id, { nodeId: "worker", prompt: "Again." });
		await waitForStatus(engine, run.id, "waiting");
		expect(harness.calls[1]).toMatchObject({
			prompt: "Again.",
			resumeSessionId: "fake-session-1",
		});
		const gates = await engine.listGates();
		expect(gates).toHaveLength(1);
		expect(gates[0]?.question).toContain("summary 2");
		expect(
			(await engine.getRun(run.id)).steps.map((s) => [
				s.nodeId,
				s.visit,
				s.outcome,
			]),
		).toEqual([
			["worker", 1, "pass"],
			["gate", 1, "stopped"],
			["worker", 2, "pass"],
			["gate", 2, null],
		]);
	});

	// The other refusals and the payloads are the re-entry planner's rows (`graph/reentry.test.ts`).
	test("a refused rerun leaves the run as it was", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", "Build it")]),
		});
		(await waitFor(() => sessions[0])).finish();
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		await expect(engine.rerunFrom(run.id, { nodeId: "inner" })).rejects.toThrow(
			`This run's flow has no node "inner"`,
		);
		expect(sessions).toHaveLength(1);
		expect(await statusOf(engine, run.id)).toBe("finished");
	});

	test("from an earlier visit: the agent continues that visit's session; a step of another node is refused", async () => {
		const harness = fakeHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: retryFlow(passOnAttempt(3), 1),
		});
		expect(await waitForEnd(engine, run.id)).toBe("failed");
		const steps = (await engine.getRun(run.id)).steps;
		expect(steps.map((s) => [s.nodeId, s.visit])).toEqual([
			["worker", 1],
			["check", 1],
			["worker", 2],
			["check", 2],
		]);
		const [firstWorker, firstCheck] = steps;
		await expect(
			engine.rerunFrom(run.id, {
				nodeId: "worker",
				stepId: firstCheck?.id ?? "",
			}),
		).rejects.toThrow(`That step is not a step of "worker"`);

		await engine.rerunFrom(run.id, {
			nodeId: "worker",
			stepId: firstWorker?.id ?? "",
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(harness.calls.map((c) => c.resumeSessionId ?? null)).toEqual([
			null,
			null,
			"fake-session-1",
		]);
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
		const items = await collect(
			engine,
			run.id,
			endedWith("finished", (entries) => entries.length === 75),
		);
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

	test("ends when the engine is disposed, so the watcher reconnects to the next one", async () => {
		const { harness, sessions } = scriptedHarness({ hang: true });
		const daemon = makeDaemon(harness);
		const engine = daemon.space(sandbox.spaceId);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", "Go")]),
		});
		await waitFor(() => sessions[0]);

		const items: RunStreamItem[] = [];
		const watching = (async () => {
			for await (const item of engine.watchRun(run.id, {
				signal: new AbortController().signal,
			})) {
				items.push(item);
			}
		})();
		await waitFor(() => items.length > 0);

		await daemon.dispose();
		await watching;
		expect(items[0]).toEqual({ kind: "status", status: "running" });
	});

	test("rejects an unknown run", async () => {
		const engine = makeEngine(scriptedHarness().harness);
		const iterator = engine
			.watchRun("missing", { signal: new AbortController().signal })
			[Symbol.asyncIterator]();
		await expect(iterator.next()).rejects.toThrow(
			"Night Shift cannot find this run.",
		);
	});
});

/** The defaults with a change: a daemon's settings, read when they apply. */
const settingsWith = (patch: Partial<RunSettings>) => (): RunSettings => ({
	...defaultRunSettings(),
	...patch,
});

describe("recovery", () => {
	test("with automatic resume off, work the daemon lost is interrupted and waits for a person", async () => {
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
		const second = makeEngine(
			harness,
			{ settings: settingsWith({ resumeInterruptedRuns: false }) },
			{ resumeGraceMs: 0 },
		);
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

describe("recovery prunes", () => {
	test("a run the daemon died in keeps only the checkpoints a re-entry reads, and resumes from them", async () => {
		const dying = scriptedHarness({ hang: true });
		const first = makeEngine(dying.harness);
		const run = await first.startRun({
			projectId: await projectId(first),
			flow: flowOf(
				[
					command("prepare", "true"),
					command("build", "true"),
					agent("worker", "Go"),
					command("check", "true"),
				],
				[
					edge("e1", "prepare", "pass", "build"),
					edge("e2", "build", "pass", "worker"),
					edge("e3", "worker", "pass", "check"),
				],
			),
		});
		await waitFor(() => dying.sessions[0]);
		const checkpoints = async () =>
			(
				await sandbox.db
					.select()
					.from(lgCheckpoint)
					.where(eq(lgCheckpoint.threadId, run.id))
			).length;
		// The saver keeps the latest checkpoint only, while the run runs.
		expect(await checkpoints()).toBe(1);
		// A database from before kept every super-step: one older checkpoint.
		await sandbox.db.$client.execute({
			sql: "INSERT INTO lg_checkpoint (thread_id, checkpoint_ns, checkpoint_id, type, checkpoint, metadata) VALUES (?, '', '0', 'json', '{}', '{}')",
			args: [run.id],
		});
		expect(await checkpoints()).toBe(2);

		// A new daemon on the same database: the run is interrupted.
		const { harness, sessions } = scriptedHarness();
		const second = makeEngine(
			harness,
			{ settings: settingsWith({ resumeInterruptedRuns: false }) },
			{ resumeGraceMs: 0 },
		);
		expect(await statusOf(second, run.id)).toBe("interrupted");
		expect(await checkpoints()).toBe(1);

		await second.resumeRun(run.id);
		(await waitFor(() => sessions[0], { label: "the resume" })).finish();
		expect(await waitForEnd(second, run.id)).toBe("finished");
		expect(
			(await second.getRun(run.id)).steps.map((s) => [s.nodeId, s.outcome]),
		).toEqual([
			["prepare", "pass"],
			["build", "pass"],
			["worker", "pass"],
			["check", "pass"],
		]);
	});
});

describe("automatic resume after a restart", () => {
	/** A daemon that dies mid-step: its harness never ends. Returns the run. */
	async function dieMidStep(
		flow: Flow = flowOf(
			[agent("worker", "Go"), command("check", "true")],
			[edge("e1", "worker", "pass", "check")],
		),
		start: { stopAt?: number } = {},
	) {
		const dying = scriptedHarness({
			hang: true,
			harnessSessionId: () => "harness-0",
		});
		const first = makeEngine(dying.harness);
		const run = await first.startRun({
			projectId: await projectId(first),
			flow,
			...start,
		});
		const lost = await waitFor(() => dying.sessions[0]);
		return { run, lost, dying };
	}

	/** A new daemon on the same database, with automatic resume after `resumeGraceMs` 0. */
	function restart(
		options: Parameters<typeof makeEngine>[1] = {},
		internals: EngineInternals = {},
	) {
		const { harness, sessions } = scriptedHarness({
			harnessSessionId: () => "harness-0",
		});
		const engine = makeEngine(harness, options, {
			resumeGraceMs: 0,
			...internals,
		});
		return { engine, sessions };
	}

	/** Gives a resume that should not come time to show up, then checks it did not. */
	async function expectNotResumed(
		engine: SpaceEngine,
		runId: string,
		sessions: unknown[],
		why: string,
	) {
		await Bun.sleep(60);
		expect(sessions).toHaveLength(0);
		const detail = await engine.getRun(runId);
		expect(detail.status).toBe("interrupted");
		expect(detail.reason).toBe(
			`Night Shift stopped while this run ran. It did not continue on its own: ${why}`,
		);
		return detail;
	}

	test("an open run continues on its own, in the same session, with the daemon as the cause", async () => {
		const { run } = await dieMidStep();
		const { engine, sessions } = restart({}, { resumeGraceMs: 30 });
		const interrupted = await engine.getRun(run.id);
		expect(interrupted.status).toBe("interrupted");
		expect(interrupted.reason).toBe("Night Shift stopped while this run ran.");

		const resumed = await waitFor(() => sessions[0]);
		expect(resumed.input.resumeSessionId).toBe("harness-0");
		expect(resumed.input.prompt).toContain(
			"Night Shift stopped while you worked on this",
		);
		expect(resumed.input.prompt).toContain("check the worktree");
		resumed.finish();
		expect(await waitForEnd(engine, run.id)).toBe("finished");

		const detail = await engine.getRun(run.id);
		expect(detail.resumes).toEqual([
			{
				at: expect.any(Number),
				by: "daemon",
				nodeId: "worker",
				reason: "Night Shift restarted.",
				action: "resume",
			},
		]);
		expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["worker", "pass"],
			["check", "pass"],
		]);
		expect(detail.steps[0]?.sessions).toHaveLength(2);
	});

	test("a reload in the same process: the old engine lets go of its run, and its late session writes nothing", async () => {
		// `bun --hot`: a new engine in the same process, while the old
		// engine's harness still runs and ignores the abort.
		const old = scriptedHarness({
			hang: true,
			harnessSessionId: () => "harness-0",
		});
		const daemon = makeDaemon(old.harness);
		const first = daemon.space(sandbox.spaceId);
		const run = await first.startRun({
			projectId: await projectId(first),
			flow: flowOf(
				[agent("worker", "Go"), command("check", "true")],
				[edge("e1", "worker", "pass", "check")],
			),
		});
		const lost = await waitFor(() => old.sessions[0]);
		await waitFor(async () =>
			(await first.getRun(run.id)).steps[0]?.sessions.length ? true : null,
		);

		await daemon.dispose();
		expect(lost.input.signal.aborted).toBe(true);

		const { engine, sessions } = restart();
		const resumed = await waitFor(() => sessions[0]);
		expect(resumed.input.resumeSessionId).toBe("harness-0");

		// The old session ends late with its own report: none of it counts.
		lost.emit({ type: "report", outcome: "fail", summary: "Too late." });
		lost.finish();
		await Bun.sleep(50);
		expect((await engine.getRun(run.id)).status).toBe("running");

		resumed.finish();
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		const detail = await engine.getRun(run.id);
		expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["worker", "pass"],
			["check", "pass"],
		]);
	});

	test.each([
		["the Settings switch", { settings: settingsWith({ scheduler: false }) }],
		["NIGHTSHIFT_SCHEDULER=off", { scheduler: false as const }],
	])(
		"with the scheduler off (%s), a run does not continue on its own",
		async (_name, options) => {
			const { run } = await dieMidStep();
			const { engine, sessions } = restart(options);
			const detail = await expectNotResumed(
				engine,
				run.id,
				sessions,
				"schedules are paused.",
			);
			expect(detail.resumes).toEqual([]);
		},
	);

	test("past its stop time, a run does not continue on its own", async () => {
		const { run } = await dieMidStep(undefined, {
			stopAt: Date.now() + 60_000,
		});
		const { engine, sessions } = restart(
			{},
			{ now: () => Date.now() + 2 * 60_000 },
		);
		await expectNotResumed(
			engine,
			run.id,
			sessions,
			"its stop time has passed.",
		);
	});

	test("a run whose worktree is gone does not continue on its own", async () => {
		const { run } = await dieMidStep();
		await rm(run.worktreePath, { recursive: true, force: true });
		const { engine, sessions } = restart();
		await expectNotResumed(
			engine,
			run.id,
			sessions,
			"the copy of the project it worked in is gone.",
		);
	});

	test("a flow's policy turns it off, and on over the Settings", async () => {
		const off = await dieMidStep({
			...flowOf([agent("worker", "Go")]),
			policy: { resumeInterruptedRuns: false },
		});
		const first = restart();
		await expectNotResumed(
			first.engine,
			off.run.id,
			first.sessions,
			"its flow turns automatic resume off.",
		);

		const on = await dieMidStep({
			...flowOf([agent("worker", "Go")]),
			policy: { resumeInterruptedRuns: true },
		});
		const second = restart({
			settings: settingsWith({ resumeInterruptedRuns: false }),
		});
		const resumed = await waitFor(() => second.sessions[0]);
		resumed.finish();
		expect(await waitForEnd(second.engine, on.run.id)).toBe("finished");
		// The first run stays as it was: off by its own policy.
		expect((await second.engine.getRun(off.run.id)).status).toBe("interrupted");
	});

	test("a run a person stopped stays stopped", async () => {
		const { harness, sessions } = scriptedHarness();
		const first = makeEngine(harness);
		const run = await first.startRun({
			projectId: await projectId(first),
			flow: flowOf([agent("worker", "Go")]),
		});
		await waitFor(() => sessions[0]);
		await first.stopRun(run.id);
		expect(await statusOf(first, run.id)).toBe("stopped");

		const second = restart();
		await Bun.sleep(60);
		expect(second.sessions).toHaveLength(0);
		const detail = await second.engine.getRun(run.id);
		expect(detail.status).toBe("stopped");
		expect(detail.resumes).toEqual([]);
	});

	test("after three automatic resumes in a row, a run waits for a person", async () => {
		const { run, dying } = await dieMidStep();
		// Each new daemon resumes the run, and dies in the same step again.
		for (let restarts = 1; restarts <= 3; restarts++) {
			makeEngine(dying.harness, {}, { resumeGraceMs: 0 });
			await waitFor(() => dying.sessions[restarts], {
				label: `session ${restarts + 1}`,
			});
		}
		const { engine, sessions } = restart();
		await expectNotResumed(
			engine,
			run.id,
			sessions,
			"it continued on its own 3 times in a row, and each time Night Shift stopped again.",
		);

		// A person's resume counts from zero again.
		await engine.resumeRun(run.id);
		const resumed = await waitFor(() => sessions[0]);
		expect(resumed.input.prompt).toBe("Continue where you left off.");
		resumed.finish();
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect((await engine.getRun(run.id)).resumes.map((r) => r.by)).toEqual([
			"daemon",
			"daemon",
			"daemon",
			"person",
		]);
	});

	test("with the run cap full, a run waits for a free slot", async () => {
		const dying = scriptedHarness({ hang: true });
		const first = makeEngine(dying.harness);
		const input = {
			projectId: await projectId(first),
			flow: flowOf([agent("worker", "Go")]),
		};
		const a = await first.startRun(input);
		const b = await first.startRun(input);
		await waitFor(() => dying.sessions[1]);

		const { engine, sessions } = restart({
			settings: settingsWith({ maxConcurrentRuns: 1 }),
		});
		const one = await waitFor(() => sessions[0]);
		await Bun.sleep(60);
		expect(sessions).toHaveLength(1);
		const statuses = async () =>
			[await statusOf(engine, a.id), await statusOf(engine, b.id)].sort();
		expect(await statuses()).toEqual(["interrupted", "running"]);

		one.finish();
		const two = await waitFor(() => sessions[1]);
		two.finish();
		await waitFor(async () =>
			(await statuses()).every((status) => status === "finished"),
		);
	});

	const HOUR = 60 * 60_000;
	/** One Agent step with an hour's budget, and a check after it. */
	const budgeted = (limits: Partial<AgentNode>) =>
		flowOf(
			[agent("worker", "Go", limits), command("check", "true")],
			[edge("e1", "worker", "pass", "check")],
		);

	test("a step past its time budget ends as its timer would, and the run does not continue", async () => {
		const { run } = await dieMidStep(budgeted({ timeoutMinutes: 60 }));
		// The new daemon starts two hours later: the budget ran out meanwhile.
		const { engine, sessions } = restart(
			{},
			{ now: () => Date.now() + 2 * HOUR },
		);
		const detail = await engine.getRun(run.id);
		expect(detail.status).toBe("failed");
		expect(detail.reason).toBe(
			'Node "worker" failed: The step ran past its time budget of 60 min.',
		);
		expect(detail.steps[0]).toMatchObject({
			outcome: "error",
			error: "The step ran past its time budget of 60 min.",
		});
		expect(detail.steps[0]?.sessions[0]?.outcome).toBe("failed");
		await Bun.sleep(60);
		expect(sessions).toHaveLength(0);
		expect(await loggedTypes()).not.toContain("RunResumed");
	});

	test("a step idle past its limit ends as its idle timer would", async () => {
		const { run } = await dieMidStep(budgeted({ idleMinutes: 30 }));
		const { engine, sessions } = restart({}, { now: () => Date.now() + HOUR });
		const detail = await engine.getRun(run.id);
		expect(detail.status).toBe("failed");
		expect(detail.steps[0]).toMatchObject({
			outcome: "error",
			error: "No activity for 30 min.",
		});
		await Bun.sleep(60);
		expect(sessions).toHaveLength(0);
	});

	test("a step within its budget is interrupted and continues as before", async () => {
		const { run } = await dieMidStep(
			budgeted({ timeoutMinutes: 60, idleMinutes: 30 }),
		);
		const { engine, sessions } = restart();
		const resumed = await waitFor(() => sessions[0]);
		expect(resumed.input.resumeSessionId).toBe("harness-0");
		resumed.finish();
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(
			(await engine.getRun(run.id)).steps.map((s) => [s.nodeId, s.outcome]),
		).toEqual([
			["worker", "pass"],
			["check", "pass"],
		]);
	});

	test("a log from before step budgets recovers as before, past any deadline", async () => {
		const { run } = await dieMidStep(budgeted({ timeoutMinutes: 60 }));
		// The log of an older Night Shift: StepStarted without the budget.
		const [started] = await sandbox.db
			.select()
			.from(event)
			.where(eq(event.type, "StepStarted"));
		if (!started) throw new Error("No StepStarted");
		const { timeoutMs, ...payload } = JSON.parse(started.payload);
		expect(timeoutMs).toBe(HOUR);
		await sandbox.db
			.update(event)
			.set({ payload: JSON.stringify(payload) })
			.where(eq(event.seq, started.seq));

		const { engine, sessions } = restart(
			{},
			{ now: () => Date.now() + 2 * HOUR },
		);
		const resumed = await waitFor(() => sessions[0]);
		expect(resumed.input.resumeSessionId).toBe("harness-0");
		expect((await engine.getRun(run.id)).steps[0]?.outcome).toBeNull();
	});
});

describe("deadlines without timers", () => {
	test("the sweep ends a running step past its budget whose harness ignores everything", async () => {
		const { harness, sessions } = scriptedHarness({ hang: true, silent: true });
		// The sweep looks every 20 ms; its interval is set before the freeze.
		const daemon = makeDaemon(
			harness,
			{},
			{ minuteMs: 100, overdueSweepMs: 20 },
		);
		const engine = daemon.space(sandbox.spaceId);
		const id = await projectId(engine);
		// The step's own timers never fire: they are set while timers are frozen.
		const run = await withFrozenTimers(async () => {
			const started = await engine.startRun({
				projectId: id,
				flow: flowOf(
					[
						agent("worker", "Go", { timeoutMinutes: 1 }),
						command("check", "true"),
					],
					[edge("e1", "worker", "pass", "check")],
				),
			});
			await waitFor(() => sessions[0]);
			return started;
		});
		const hung = sessions[0] as (typeof sessions)[number];

		// Within its budget, and its grace: the sweep leaves it alone.
		await Bun.sleep(40);
		expect(await statusOf(engine, run.id)).toBe("running");

		// One minute (100 ms) of budget, one minute of grace.
		await waitFor(() => hung.input.signal.aborted, { label: "the sweep" });
		const detail = await engine.getRun(run.id);
		expect(detail.status).toBe("failed");
		expect(detail.reason).toBe(
			'Node "worker" failed: The step ran past its time budget of 1 min.',
		);
		expect(detail.steps.map((s) => [s.nodeId, s.outcome, s.error])).toEqual([
			["worker", "error", "The step ran past its time budget of 1 min."],
		]);
		expect(detail.steps[0]?.sessions[0]?.outcome).toBe("failed");

		// The hung harness wakes later: its drive writes nothing more.
		const ended = await loggedTypes();
		hung.finish(1);
		await Bun.sleep(100);
		expect(await loggedTypes()).toEqual(ended);
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
		options: labels.map((name) => ({ name })),
		by: "model",
		decider: "typesafe",
		model: "jev-1.13.0",
		...extra,
	};
}

/** A Gate: a Decision decided by a person. */
function gate(
	id: string,
	question: string,
	choices: string[],
	extra: Partial<DecisionNode> = {},
): DecisionNode {
	return {
		id,
		type: "decision",
		position: { x: 0, y: 0 },
		prompt: question,
		options: choices.map((name) => ({ name })),
		by: "person",
		decider: "typesafe",
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
						options: [
							{ name: "ship", description: "Good enough" },
							{ name: "redo" },
						],
					},
				),
				agent("shipper", "Ship it. {{decide.note}} ({{decide.outcome}})"),
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
			decider: "typesafe",
			prompt: "Worker said: Built the parser.",
			labels: [{ name: "ship", description: "Good enough" }, { name: "redo" }],
			model: "jev-1.13.0",
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
			outputs: { outcome: "ship", note: "The tests pass.", visit: 1 },
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
				model: "jev-1.13.0",
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
			outputs: { outcome: "error", note: "", visit: 1 },
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
			'"maybe" is not an option of this node. Choose one of: yes, no.',
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

	test("startRun refuses a flow with an Agent checker when no decider is configured", async () => {
		const engine = makeEngine(fakeHarness());
		await expect(
			engine.startRun({
				projectId: await projectId(engine),
				flow: flowOf([
					agent("worker", "Work", { checker: { decider: "typesafe" } }),
				]),
			}),
		).rejects.toThrow(
			"The flow has an Agent node with a checker, but no decider is configured.",
		);
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

async function openGateOf(engine: SpaceEngine, runId: string) {
	return waitFor(
		async () => (await engine.listGates()).find((g) => g.runId === runId),
		{ label: "an open gate" },
	);
}

describe("gates", () => {
	test("a Gate of a flow file names its flow", async () => {
		const harness = fakeHarness((_input, call) =>
			call === 0 ? reportingScript("pass", "Built the parser.") : {},
		);
		const engine = makeEngine(harness, { maxConcurrentRuns: 1 });
		const id = await projectId(engine);
		await engine.saveFlow(id, "ship", gateFlow());
		const run = await engine.startRun({ projectId: id, flowName: "ship" });

		expect(await openGateOf(engine, run.id)).toMatchObject({
			flowName: "ship",
			runTitle: "ship",
		});
		await engine.stopRun(run.id);
	});

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
			flowName: null,
			projectId: id,
			projectName: "repo",
			nodeId: "gate",
			question: "The worker said: Built the parser.. Ship it?",
			choices: [{ name: "approve" }, { name: "reject" }],
			lockScreen: false,
		});
		let detail = await engine.getRun(run.id);
		expect(detail.steps.at(-1)).toMatchObject({
			id: open?.stepId,
			nodeType: "decision",
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
		const watching = collect(
			engine,
			run.id,
			endedWith("finished", (entries) =>
				entries.some((e) => e.event.type === "gate-resolved"),
			),
		);
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

	test("onRunEvents tells of each run event that lands, with its Space", async () => {
		const daemon = makeDaemon(fakeHarness());
		const engine = daemon.space(sandbox.spaceId);
		const landed: { type: string; spaceId: string; runId: string }[] = [];
		const off = daemon.onRunEvents((events) => {
			for (const e of events) {
				landed.push({ type: e.type, spaceId: e.spaceId, runId: e.runId });
			}
		});
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: gateFlow(),
		});
		const open = await openGateOf(engine, run.id);
		await waitFor(async () => landed.find((e) => e.type === "GateOpened"), {
			label: "the Gate's event",
		});
		off();
		await engine.resolveGate({
			runId: run.id,
			stepId: open.stepId,
			choice: "approve",
		});
		await waitForEnd(engine, run.id);

		expect(landed[0]).toEqual({
			type: "RunStarted",
			spaceId: sandbox.spaceId,
			runId: run.id,
		});
		// Nothing after the unsubscribe.
		expect(landed.map((e) => e.type)).not.toContain("RunEnded");
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
			'"yes" is not an option of this node. Choose one of: approve, reject.',
		);
		await expect(
			engine.resolveGate({
				runId: run.id,
				stepId: workerStep,
				choice: "approve",
			}),
		).rejects.toBeInstanceOf(GateClosedError);
		await expect(
			engine.resolveGate({
				runId: "missing",
				stepId: open.stepId,
				choice: "approve",
			}),
		).rejects.toThrow("Night Shift cannot find this run.");
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
		).rejects.toBeInstanceOf(GateClosedError);
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

	test("the run list and the inbox follow each append, as a new daemon reads them", async () => {
		const engine = makeEngine(fakeHarness());
		const id = await projectId(engine);
		const run = await engine.startRun({ projectId: id, flow: gateFlow() });
		const open = await openGateOf(engine, run.id);
		// A new daemon reads the database, with nothing in memory.
		const fresh = () =>
			makeEngine(fakeHarness(), {}, { signal: AbortSignal.abort() });
		expect(await engine.listRuns()).toEqual(await fresh().listRuns());
		expect(await engine.listGates()).toEqual(await fresh().listGates());

		await engine.resolveGate({
			runId: run.id,
			stepId: open.stepId,
			choice: "approve",
		});
		expect(await waitForEnd(engine, run.id)).toBe("finished");
		expect(await engine.listGates()).toEqual([]);
		const runs = await engine.listRuns();
		expect(runs[0]?.status).toBe("finished");
		expect(runs).toEqual(await fresh().listRuns());
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
		const engine = makeEngine(harness, {
			decider,
			maxConcurrentRuns: 1,
			cliNames: () => new Set(["gh"]),
			findCli: (name) => `/usr/local/bin/${name}`,
		});
		const flow = flowOf(
			[
				agent("worker", "Build it. Reviewer: {{gate.note}}", {
					clis: ["gh"],
				}),
				decision("decide", "Worker: {{worker.summary}}. Review it?", [
					"retry",
					"review",
				]),
				gate("gate", "{{worker.summary}} ({{decide.note}}). Ship it?", [
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
		expect(harness.calls.every((c) => c.clis?.join() === "gh")).toBe(true);
		expect(calls.map((c) => c.prompt)).toEqual([
			"Worker: attempt 1. Review it?",
			"Worker: attempt 2. Review it?",
			"Worker: attempt 3. Review it?",
		]);
		expect(detail.costUsd).toBeCloseTo(sessionCostOf(detail) + 0.03);
	});
});

describe("wait nodes", () => {
	const wait = (id: string, until: WaitNode["until"]): WaitNode => ({
		id,
		type: "wait",
		position: { x: 0, y: 0 },
		until,
	});

	test("a duration sleeps the run on the engine's timer, and the wake continues the flow", async () => {
		const clock = sleepClock();
		const engine = makeEngine(
			fakeHarness(),
			{},
			{ minuteMs: 50, now: clock.now },
		);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					wait("pause", { kind: "duration", minutes: 2 }),
					command("after", "echo {{pause.waited_minutes}}"),
				],
				[edge("e1", "pause", "done", "after")],
			),
		});
		await waitForStatus(engine, run.id, "sleeping");
		const sleeping = await engine.getRun(run.id);
		// Two minutes from now on the engine's clock: it stands still meanwhile.
		expect(sleeping.wakeAt).toBe(clock.now() + 2 * 50);
		expect(sleeping.signal).toBeNull();
		const detail = await clock.follow(engine, run.id);
		expect(detail.status).toBe("finished");
		expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["pause", "done"],
			["after", "pass"],
		]);
		expect(detail.steps[1]?.outputs.log_tail).toBe("2");
	});

	test("a signal: the run waits with no wake time, the wrong name is refused, and the right one ends the wait", async () => {
		const engine = makeEngine(fakeHarness());
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					wait("deploy", { kind: "signal", name: "deployed" }),
					command("after", "echo after"),
				],
				[edge("e1", "deploy", "done", "after")],
			),
		});
		await waitForStatus(engine, run.id, "sleeping");
		const sleeping = await engine.getRun(run.id);
		expect(sleeping.wakeAt).toBeNull();
		expect(sleeping.signal).toBe("deployed");

		await expect(engine.signalRun(run.id, "tested")).rejects.toThrow(
			"This run does not wait for that signal.",
		);
		await expect(engine.signalRun("missing", "deployed")).rejects.toThrow(
			"Night Shift cannot find this run.",
		);
		expect(await statusOf(engine, run.id)).toBe("sleeping");

		await engine.signalRun(run.id, "deployed");
		await waitForStatus(engine, run.id, "finished");
		const detail = await engine.getRun(run.id);
		expect(detail.steps[0]).toMatchObject({
			nodeId: "deploy",
			outcome: "done",
			outputs: { outcome: "done", waited_minutes: 0, visit: 1 },
		});
		await expect(engine.signalRun(run.id, "deployed")).rejects.toThrow(
			"This run does not wait for that signal.",
		);
		// The transcript says what woke it.
		const items = await collect(engine, run.id, (_item, all) =>
			entriesOf(all).some((e) => e.event.type === "wake"),
		);
		expect(
			entriesOf(items)
				.filter((e) => e.stepId === detail.steps[0]?.id)
				.map((e) => e.event),
		).toEqual([
			{
				type: "wait",
				reason: "signal",
				until: null,
				message: 'Waits for the signal "deployed".',
				signal: "deployed",
			},
			{ type: "wake", signal: "deployed" },
		]);
	});

	test("a new daemon gets the wake timer of a sleeping Wait node back, and a signal wait stays open", async () => {
		const dying = new AbortController();
		// The clock stands still: this daemon never reaches the wake time.
		const clock = sleepClock();
		const first = makeEngine(
			fakeHarness(),
			{},
			{ minuteMs: 50, now: clock.now, signal: dying.signal },
		);
		const id = await projectId(first);
		const timed = await first.startRun({
			projectId: id,
			flow: flowOf(
				[
					wait("pause", { kind: "duration", minutes: 60 }),
					command("after", "echo after"),
				],
				[edge("e1", "pause", "done", "after")],
			),
		});
		const signalled = await first.startRun({
			projectId: id,
			flow: flowOf([wait("deploy", { kind: "signal", name: "deployed" })]),
		});
		await waitForStatus(first, timed.id, "sleeping");
		await waitForStatus(first, signalled.id, "sleeping");
		// The daemon dies: its timers go with it.
		dying.abort();

		// A new daemon on the same database, with a clock past the wake time:
		// the timer fires at once.
		const second = makeEngine(
			fakeHarness(),
			{},
			{ minuteMs: 50, now: () => clock.now() + 61 * 50 },
		);
		expect(await statusOf(second, signalled.id)).toBe("sleeping");
		await waitForStatus(second, timed.id, "finished");
		const detail = await second.getRun(timed.id);
		expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["pause", "done"],
			["after", "pass"],
		]);
		expect(await loggedTypes()).not.toContain("RunResumed");

		// The signal wait survived the restart and still answers to its signal.
		expect((await second.getRun(signalled.id)).signal).toBe("deployed");
		await second.signalRun(signalled.id, "deployed");
		await waitForStatus(second, signalled.id, "finished");
	});

	test("stop ends a sleeping Wait step, and resume starts it again", async () => {
		const engine = makeEngine(fakeHarness());
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([wait("deploy", { kind: "signal", name: "deployed" })]),
		});
		await waitForStatus(engine, run.id, "sleeping");
		await engine.stopRun(run.id);
		expect(await statusOf(engine, run.id)).toBe("stopped");
		expect((await engine.getRun(run.id)).steps[0]?.outcome).toBe("stopped");
		await engine.resumeRun(run.id);
		await waitForStatus(engine, run.id, "sleeping");
		expect(
			(await engine.getRun(run.id)).steps.map((s) => [s.visit, s.outcome]),
		).toEqual([
			[1, "stopped"],
			[2, null],
		]);
		await engine.signalRun(run.id, "deployed");
		await waitForStatus(engine, run.id, "finished");
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
