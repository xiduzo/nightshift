import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	fakeDecider,
	fakeHarness,
	usageLimitScript,
} from "@nightshift/agents/fake";
import type { AgentHarness } from "@nightshift/agents/types";
import { event } from "@nightshift/db/schema";
import type {
	AgentNode,
	CallEach,
	CallEachNode,
	CallNode,
	CommandNode,
	DecisionNode,
	Flow,
	FlowEdge,
	FlowInput,
} from "@nightshift/flows";
import { asc, eq } from "drizzle-orm";

import { createEngine, type EngineInternals } from "./engine";
import { createRunLog, type RunLog } from "./run-log";
import {
	createSandbox,
	expectRunLogsInSync,
	mustGit,
	type Sandbox,
	scriptedHarness,
	type TestEngineOptions,
	waitFor,
	withDevice,
} from "./test-support";
import type {
	RunDetail,
	RunStatus,
	RunStreamItem,
	SpaceEngine,
	StepSummary,
	TranscriptEntry,
} from "./types";

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
	options: Partial<
		Pick<TestEngineOptions, "maxConcurrentRuns" | "maxStepsPerRun" | "decider">
	> = {},
	internals: EngineInternals = {},
): SpaceEngine {
	const runLog = createRunLog(sandbox.db);
	runLogs.push(runLog);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": harness },
			dataDir: sandbox.dataDir,
			...options,
		}),
		{ runLog, ...internals },
	).space(sandbox.spaceId);
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

function decision(id: string, labels: string[]): DecisionNode {
	return {
		id,
		type: "decision",
		position: { x: 0, y: 0 },
		prompt: "Go on with {{item.title}}?",
		options: labels.map((name) => ({ name })),
		by: "model",
		decider: "typesafe",
		model: "jev-1.13.0",
	};
}

/** A Call node with `each`: `extra` fills `each`, except `inputs` and `timeoutMinutes`. */
function callEach(
	id: string,
	body: string,
	sourceCommand: string,
	extra: Partial<CallEach> &
		Partial<Pick<CallNode, "inputs" | "timeoutMinutes">> = {},
): CallEachNode {
	const { inputs, timeoutMinutes, ...each } = extra;
	return {
		id,
		type: "call",
		position: { x: 0, y: 0 },
		flow: body,
		inputs: inputs ?? {},
		...(timeoutMinutes === undefined ? {} : { timeoutMinutes }),
		each: {
			source: { kind: "command", command: sourceCommand },
			as: "item",
			branch: "per-item",
			haltOn: ["halt"],
			...each,
		},
	};
}

function edge(
	id: string,
	from: string,
	outcome: FlowEdge["outcome"],
	to: string,
): FlowEdge {
	return { id, from, outcome, to };
}

function flowOf(
	nodes: Flow["nodes"],
	edges: FlowEdge[] = [],
	extra: Partial<Flow> = {},
): Flow {
	return {
		version: 5,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges,
		...extra,
	};
}

/** Writes a called flow file (with the input `item`) into the clone. */
async function saveBody(
	name: string,
	nodes: Flow["nodes"],
	edges: FlowEdge[] = [],
): Promise<void> {
	const dir = join(sandbox.repoPath, ".nightshift", "flows");
	await mkdir(dir, { recursive: true });
	const flow: FlowInput = {
		...flowOf(nodes, edges),
		inputs: [{ name: "item", type: "json", required: true }],
	};
	await writeFile(join(dir, `${name}.json`), JSON.stringify(flow));
}

/** A command source that prints these items. */
function printItems(items: unknown[]): string {
	return `printf '%s' '${JSON.stringify(items)}'`;
}

/** Commits a file named after the item, so the worktree is clean for the next item. */
const commitItem = `echo "{{run.branch}}" > "item-{{item.id}}.txt" && git add -A && git -c user.name=t -c user.email=t@nightshift.invalid -c commit.gpgsign=false commit -q -m "item {{item.id}}"`;

async function projectId(engine: SpaceEngine): Promise<string> {
	return (await engine.addProject({ repoPath: sandbox.repoPath })).id;
}

async function waitForStatus(
	engine: SpaceEngine,
	runId: string,
	status: RunStatus,
) {
	return waitFor(
		async () => {
			const detail = await engine.getRun(runId);
			return detail.status === status ? detail : null;
		},
		{ label: `status ${status}` },
	);
}

async function waitForEnd(
	engine: SpaceEngine,
	runId: string,
): Promise<RunDetail> {
	return waitFor(
		async () => {
			const detail = await engine.getRun(runId);
			const open = ["running", "sleeping", "waiting"].includes(detail.status);
			return open ? null : detail;
		},
		{ label: "the run to end" },
	);
}

const callEachStep = (detail: RunDetail, nodeId = "loop"): StepSummary => {
	const found = detail.steps.find(
		(s) => s.nodeId === nodeId && s.nodeType === "call",
	);
	if (!found) throw new Error(`No Call step ${nodeId}`);
	return found;
};

async function readTranscript(
	runId: string,
	stepId: string,
): Promise<TranscriptEntry[]> {
	const text = await readFile(
		join(sandbox.dataDir, "transcripts", runId, `${stepId}.ndjson`),
		"utf8",
	);
	return text
		.trim()
		.split("\n")
		.map((l) => JSON.parse(l) as TranscriptEntry);
}

async function loggedEvents(runId: string) {
	const rows = await sandbox.db
		.select()
		.from(event)
		.where(eq(event.runId, runId))
		.orderBy(asc(event.seq));
	return rows.map((r) => ({ type: r.type, payload: JSON.parse(r.payload) }));
}

describe("Call with each", () => {
	test("runs the body per item, blockers first, each item on a branch stacked on the last done one", async () => {
		await saveBody(
			"build",
			[agent("worker", "Build {{item.title}}"), command("commit", commitItem)],
			[edge("b1", "worker", "pass", "commit")],
		);
		const harness = fakeHarness();
		const engine = makeEngine(harness);
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				callEach(
					"loop",
					"build",
					printItems([
						{ id: "1", title: "first listed", blockedBy: ["2"] },
						{ id: "2", title: "its blocker" },
						{ id: "3", title: "done already", done: true },
					]),
				),
			]),
		});
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("finished");
		expect(detail.reason).toBeNull();
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			"Build its blocker",
			"Build first listed",
		]);

		const loop = callEachStep(detail);
		expect(loop.outcome).toBe("done");
		expect(loop.scope).toBeNull();
		expect(loop.items.map((i) => [i.id, i.state])).toEqual([
			["2", "done"],
			["1", "done"],
		]);
		expect(loop.outputs).toMatchObject({
			outcome: "done",
			done_count: 2,
			failed_count: 0,
			blocked_count: 0,
			waiting_count: 0,
			summary: "#2 done\n#1 done",
		});

		const short = started.id.slice(0, 8);
		const [second, first] = loop.items;
		expect(second?.branch).toBe(`nightshift/${short}-2-its-blocker`);
		expect(second?.baseBranch).toBe(started.branch);
		expect(first?.branch).toBe(`nightshift/${short}-1-first-listed`);
		expect(first?.baseBranch).toBe(second?.branch ?? "");

		// The stack: item 1's commit sits on top of item 2's.
		const wt = started.worktreePath;
		expect(await mustGit(wt, ["rev-parse", `${first?.branch}^`])).toBe(
			await mustGit(wt, ["rev-parse", `${second?.branch}`]),
		);
		expect(await mustGit(wt, ["rev-parse", `${second?.branch}^`])).toBe(
			await mustGit(wt, ["rev-parse", started.branch]),
		);
		// {{run.branch}} reached the body's command.
		expect(await mustGit(wt, ["show", `${first?.branch}:item-1.txt`])).toBe(
			first?.branch ?? "",
		);

		// Body steps run in the scope of their item.
		const bodySteps = detail.steps.filter((s) => s.scope !== null);
		expect(bodySteps.map((s) => [s.nodeId, s.scope?.itemId, s.visit])).toEqual([
			["worker", "2", 1],
			["commit", "2", 1],
			["worker", "1", 1],
			["commit", "1", 1],
		]);
		expect(new Set(bodySteps.map((s) => s.scope?.parentStepId))).toEqual(
			new Set([loop.id]),
		);

		const transcript = await readTranscript(started.id, loop.id);
		expect(transcript.map((e) => e.event.type)).toEqual([
			"items-read",
			"item-start",
			"item-end",
			"items-read",
			"item-start",
			"item-end",
			"items-read",
		]);
		expect(transcript[0]?.event).toEqual({
			type: "items-read",
			count: 3,
			open: 2,
		});
		const types = (await loggedEvents(started.id)).map((e) => e.type);
		expect(types.filter((t) => t.startsWith("Item"))).toEqual([
			"ItemsRead",
			"ItemStarted",
			"ItemEnded",
			"ItemsRead",
			"ItemStarted",
			"ItemEnded",
			"ItemsRead",
		]);
	});

	test("without a branch per item, all items share the current branch", async () => {
		await saveBody("build", [command("commit", commitItem)]);
		const engine = makeEngine(fakeHarness());
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				callEach(
					"loop",
					"build",
					printItems([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
					]),
					{ branch: "shared" },
				),
			]),
		});
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("finished");
		expect(callEachStep(detail).items.map((i) => i.branch)).toEqual([
			null,
			null,
		]);
		const wt = started.worktreePath;
		expect(await mustGit(wt, ["branch", "--show-current"])).toBe(
			started.branch,
		);
		expect(await mustGit(wt, ["show", "HEAD:item-2.txt"])).toBe(started.branch);
		expect(await mustGit(wt, ["show", "HEAD^:item-1.txt"])).toBe(
			started.branch,
		);
	});

	test("a failed item blocks its dependents, and the loop goes on with free work", async () => {
		await saveBody("build", [
			command("check", `test "{{item.id}}" != 1 && ${commitItem}`),
		]);
		const engine = makeEngine(fakeHarness());
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					callEach(
						"loop",
						"build",
						printItems([
							{ id: "1", title: "fails" },
							{ id: "2", title: "waits on 1", blockedBy: ["1"] },
							{ id: "4", title: "waits on 2", blockedBy: ["2"] },
							{ id: "3", title: "free" },
						]),
					),
					command("after", `echo "{{loop.summary}}"`),
				],
				[edge("e1", "loop", "done", "after")],
			),
		});
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("finished");
		const loop = callEachStep(detail);
		expect(loop.items.map((i) => [i.id, i.state, i.reason])).toEqual([
			["1", "failed", expect.any(String)],
			["2", "blocked", "blocked by #1"],
			["4", "blocked", "blocked by #2"],
			["3", "done", null],
		]);
		expect(loop.items[0]?.reason).toContain(
			`Node "check" ended with "fail" and no edge leaves it on that outcome.`,
		);
		expect(loop.outputs).toMatchObject({
			done_count: 1,
			failed_count: 1,
			blocked_count: 2,
		});
		expect(String(loop.outputs.summary).split("\n")).toEqual([
			`#1 failed: Node "check" ended with "fail" and no edge leaves it on that outcome.`,
			"#2 blocked by #1",
			"#4 blocked by #2",
			"#3 done",
		]);
		const after = detail.steps.find((s) => s.nodeId === "after");
		expect(after?.outputs.log_tail).toContain("#3 done");
		// A blocked item never ran its flow.
		const [listed] = await engine.listRuns();
		expect(listed?.subflows.map((s) => [s.flowName, s.status])).toEqual([
			["build", "failed"],
			["build", "finished"],
		]);
		// Item 3 builds on the start: no item before it was done.
		expect(loop.items[3]?.baseBranch).toBe(started.branch);
	});

	test("a body that ends on a haltOn label halts the loop", async () => {
		await saveBody("build", [decision("ask", ["go", "halt"])]);
		const decider = fakeDecider([{ label: "go" }, { label: "halt" }]);
		const engine = makeEngine(fakeHarness(), { decider });
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				callEach(
					"loop",
					"build",
					printItems([
						{ id: "1", title: "one" },
						{ id: "2", title: "two" },
						{ id: "3", title: "three" },
					]),
					{ branch: "shared" },
				),
			]),
		});
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("finished");
		expect(detail.reason).toBe(`Ended at node "loop" with "halted".`);
		const loop = callEachStep(detail);
		expect(loop.outcome).toBe("halted");
		expect(loop.items.map((i) => [i.id, i.state])).toEqual([
			["1", "done"],
			["2", "halted"],
		]);
		expect(loop.items[1]?.reason).toBe(`Ended at node "ask" with "halt".`);
		expect(loop.outputs.waiting_count).toBe(1);
		expect(String(loop.outputs.summary).split("\n")).toEqual([
			"#1 done",
			`#2 halted: Ended at node "ask" with "halt".`,
			"#3 not started",
		]);
		expect(decider.calls[1]?.prompt).toBe("Go on with two?");
	});

	test("the source is read again before each item: an item added mid-run gets built", async () => {
		const itemsFile = join(sandbox.root, "items.json");
		await writeFile(itemsFile, JSON.stringify([{ id: "1", title: "a" }]));
		await saveBody("build", [agent("worker", "Build {{item.title}}")]);
		const harness = fakeHarness((_input, call) => {
			if (call === 0) {
				writeFileSync(
					itemsFile,
					JSON.stringify([
						{ id: "1", title: "a", done: true },
						{ id: "2", title: "added" },
					]),
				);
			}
			return {};
		});
		const engine = makeEngine(harness);
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				callEach("loop", "build", `cat '${itemsFile}'`, {
					branch: "shared",
				}),
			]),
		});
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("finished");
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			"Build a",
			"Build added",
		]);
		expect(callEachStep(detail).items.map((i) => i.id)).toEqual(["1", "2"]);
	});

	test("maxItems caps the items one visit starts", async () => {
		await saveBody("build", [agent("worker", "Build {{item.title}}")]);
		const harness = fakeHarness();
		const engine = makeEngine(harness);
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				callEach(
					"loop",
					"build",
					printItems([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
						{ id: "3", title: "c" },
					]),
					{ branch: "shared", maxItems: 2 },
				),
			]),
		});
		const detail = await waitForEnd(engine, started.id);
		expect(harness.calls).toHaveLength(2);
		expect(callEachStep(detail).outputs).toMatchObject({
			outcome: "done",
			done_count: 2,
			waiting_count: 1,
		});
	});

	test("a source that prints no item list fails the step; a cycle too", async () => {
		await saveBody("build", [agent("worker", "Build")]);
		const engine = makeEngine(fakeHarness());
		const id = await projectId(engine);
		const bad = await engine.startRun({
			projectId: id,
			flow: flowOf([callEach("loop", "build", "echo not json")]),
		});
		const badDetail = await waitForEnd(engine, bad.id);
		expect(badDetail.status).toBe("failed");
		expect(callEachStep(badDetail).outcome).toBe("error");
		expect(badDetail.reason).toContain("did not print JSON");

		const cyclic = await engine.startRun({
			projectId: id,
			flow: flowOf([
				callEach(
					"loop",
					"build",
					printItems([
						{ id: "1", title: "a", blockedBy: ["2"] },
						{ id: "2", title: "b", blockedBy: ["1"] },
					]),
				),
			]),
		});
		const cyclicDetail = await waitForEnd(engine, cyclic.id);
		expect(cyclicDetail.status).toBe("failed");
		expect(cyclicDetail.reason).toContain("make a cycle");
	});

	test("a dirty worktree fails the item instead of committing for it", async () => {
		await saveBody("build", [command("scribble", "echo x > loose.txt")]);
		const engine = makeEngine(fakeHarness());
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				callEach(
					"loop",
					"build",
					printItems([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
					]),
				),
			]),
		});
		const detail = await waitForEnd(engine, started.id);
		const loop = callEachStep(detail);
		expect(loop.items.map((i) => [i.id, i.state])).toEqual([
			["1", "done"],
			["2", "failed"],
		]);
		expect(loop.items[1]?.reason).toContain("loose.txt");
		expect(loop.items[1]?.reason).toContain(
			"Night Shift does not commit for you",
		);
		expect(loop.items[1]?.branch).toBeNull();
	});

	test("nested For Each: scopes nest, outputs and sessions stay per item, and the stack continues across outer items", async () => {
		// Outer: features on the current branch. Inner: traces, a branch each.
		await saveBody(
			"feature",
			[
				callEach(
					"traces",
					"trace",
					`printf '[{"id":"%s-1","title":"t"}]' "{{item.id}}"`,
				),
				agent("worker", "Feature {{item.id}}: {{traces.done_count}} built", {
					session: "resume",
				}),
			],
			[edge("f1", "traces", "done", "worker")],
		);
		await saveBody(
			"trace",
			[
				agent("worker", "Trace {{item.id}} on {{run.branch}}"),
				command("commit", commitItem),
			],
			[edge("t1", "worker", "pass", "commit")],
		);
		const harness = fakeHarness();
		const engine = makeEngine(harness);
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					callEach(
						"loop",
						"feature",
						printItems([
							{ id: "f1", title: "one" },
							{ id: "f2", title: "two" },
						]),
						{ branch: "shared" },
					),
					agent("worker", "Top {{loop.done_count}}"),
				],
				[edge("e1", "loop", "done", "worker")],
			),
		});
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("finished");
		expect(Object.keys(detail.calledFlows).sort()).toEqual([
			"feature",
			"trace",
		]);
		const short = started.id.slice(0, 8);
		const t1 = `nightshift/${short}-f1-1-t`;
		const t2 = `nightshift/${short}-f2-1-t`;
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			`Trace f1-1 on ${t1}`,
			"Feature f1: 1 built",
			`Trace f2-1 on ${t2}`,
			"Feature f2: 1 built",
			"Top 2",
		]);
		// A body's `session: "resume"` never resumes another item's session.
		expect(harness.calls[1]?.resumeSessionId).toBeUndefined();
		expect(harness.calls[3]?.resumeSessionId).toBeUndefined();

		// Each item is a run of its flow, found in the flow that holds the Call.
		const [listed] = await engine.listRuns();
		expect(
			listed?.subflows.map((s) => [s.flowName, s.status, s.costUsd]),
		).toEqual([
			["feature", "finished", 0.002],
			["trace", "finished", 0.001],
			["feature", "finished", 0.002],
			["trace", "finished", 0.001],
		]);

		const outer = callEachStep(detail, "loop");
		const inner = detail.steps.filter((s) => s.nodeId === "traces");
		expect(inner.map((s) => s.scope)).toEqual([
			{ parentStepId: outer.id, itemId: "f1" },
			{ parentStepId: outer.id, itemId: "f2" },
		]);
		const traceWorkers = detail.steps.filter(
			(s) => s.nodeId === "worker" && s.scope?.itemId?.endsWith("-1"),
		);
		expect(traceWorkers.map((s) => s.scope?.parentStepId)).toEqual(
			inner.map((s) => s.id),
		);
		// Every "worker" counts its own visits per scope.
		expect(
			detail.steps.filter((s) => s.nodeId === "worker").map((s) => s.visit),
		).toEqual([1, 1, 1, 1, 1]);

		// The first trace of f2 builds on what f1 left checked out: its trace.
		expect(inner[1]?.items[0]?.baseBranch).toBe(t1);
		const wt = started.worktreePath;
		expect(await mustGit(wt, ["rev-parse", `${t2}^`])).toBe(
			await mustGit(wt, ["rev-parse", t1]),
		);
	});

	test("startRun refuses a missing body, a body with errors, and a body flow on its own", async () => {
		const engine = makeEngine(fakeHarness());
		const id = await projectId(engine);
		await expect(
			engine.startRun({
				projectId: id,
				flow: flowOf([callEach("loop", "missing", printItems([]))]),
			}),
		).rejects.toThrow("cannot run");

		await saveBody("broken", [agent("worker", "{{nowhere.output}}")]);
		await expect(
			engine.startRun({
				projectId: id,
				flow: flowOf([callEach("loop", "broken", printItems([]))]),
			}),
		).rejects.toThrow("cannot run");

		await saveBody("fine", [agent("worker", "Build {{item.title}}")]);
		await expect(
			engine.startRun({ projectId: id, flowName: "fine" }),
		).rejects.toThrow("The flow needs a value for: item.");
		expect(await engine.listRuns()).toEqual([]);
	});

	test("stop inside an item, then resume continues the same item, and the loop after it", async () => {
		await saveBody(
			"build",
			[agent("worker", "Build {{item.title}}"), command("commit", commitItem)],
			[edge("b1", "worker", "pass", "commit")],
		);
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				callEach(
					"loop",
					"build",
					printItems([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
					]),
				),
			]),
		});
		await waitFor(() => sessions[0]);
		await engine.stopRun(started.id);
		const stopped = await engine.getRun(started.id);
		expect(stopped.status).toBe("stopped");
		const loopStopped = callEachStep(stopped);
		expect(loopStopped.outcome).toBe("stopped");
		// The item no longer runs: it shows failed with why, until a resume.
		expect(
			loopStopped.items.map((i) => [i.id, i.state, i.reason, i.endedAt]),
		).toEqual([
			["1", "failed", "The run stopped during this item.", loopStopped.endedAt],
		]);

		await engine.resumeRun(started.id);
		const resumed = await waitFor(() => sessions[1]);
		const running = callEachStep(await engine.getRun(started.id));
		expect(running.items.map((i) => [i.id, i.state, i.reason])).toEqual([
			["1", "running", null],
		]);
		expect(resumed.input.resumeSessionId).toBe("harness-0");
		expect(resumed.input.prompt).toBe("Continue where you left off.");
		resumed.finish();
		const second = await waitFor(() => sessions[2]);
		expect(second.input.prompt).toBe("Build b");
		second.finish();

		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("finished");
		const loop = callEachStep(detail);
		expect(loop.id).toBe(loopStopped.id);
		expect(loop.outcome).toBe("done");
		expect(loop.items.map((i) => [i.id, i.state])).toEqual([
			["1", "done"],
			["2", "done"],
		]);
		const workers = detail.steps.filter((s) => s.nodeId === "worker");
		expect(workers.map((s) => s.sessions.length)).toEqual([2, 1]);
		expect(loop.items[1]?.baseBranch).toBe(loop.items[0]?.branch ?? "");
	});

	test("a Gate inside a body waits, and its answer continues the item", async () => {
		await saveBody("build", [
			{
				id: "ask",
				type: "decision",
				position: { x: 0, y: 0 },
				prompt: "Ship {{item.title}}?",
				options: [{ name: "yes" }, { name: "halt" }],
				by: "person",
				decider: "typesafe",
			},
		]);
		const engine = makeEngine(fakeHarness());
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				callEach(
					"loop",
					"build",
					printItems([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
					]),
					{ branch: "shared" },
				),
			]),
		});
		await waitForStatus(engine, started.id, "waiting");
		const [first] = await engine.listGates();
		expect(first?.question).toBe("Ship a?");
		await engine.resolveGate({
			runId: started.id,
			stepId: first?.stepId ?? "",
			choice: "yes",
		});
		const second = await waitFor(async () => {
			const gates = await engine.listGates();
			return gates[0]?.question === "Ship b?" ? gates[0] : null;
		});
		await engine.resolveGate({
			runId: started.id,
			stepId: second.stepId,
			choice: "halt",
		});
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("finished");
		expect(callEachStep(detail).items.map((i) => i.state)).toEqual([
			"done",
			"halted",
		]);
	});

	test("watchRun sends the For Each step as its items change", async () => {
		await saveBody("build", [agent("worker", "Build {{item.title}}")]);
		const engine = makeEngine(fakeHarness());
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				callEach(
					"loop",
					"build",
					printItems([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
					]),
					{ branch: "shared" },
				),
			]),
		});
		const controller = new AbortController();
		const items: RunStreamItem[] = [];
		const timeout = setTimeout(() => controller.abort(), 5_000);
		for await (const item of engine.watchRun(started.id, {
			signal: controller.signal,
		})) {
			items.push(item);
			if (item.kind === "status" && item.status === "finished") {
				controller.abort();
			}
		}
		clearTimeout(timeout);
		const loopUpdates = items.flatMap((i) =>
			i.kind === "step" && i.step.nodeType === "call" ? [i.step] : [],
		);
		const seen = loopUpdates.map(
			(s) =>
				`${s.items.map((i) => `${i.id}:${i.state}`).join(",")}|${s.outcome}`,
		);
		expect(seen).toContain("1:running|null");
		expect(seen).toContain("1:done,2:running|null");
		expect(seen.at(-1)).toBe("1:done,2:done|done");
		const bodyUpdates = items.flatMap((i) =>
			i.kind === "step" && i.step.scope ? [i.step.scope.itemId] : [],
		);
		expect(new Set(bodyUpdates)).toEqual(new Set(["1", "2"]));
	});

	test("a loop over 30 elements finishes in one drive: the graph's own super-step limit is out of the way", async () => {
		await saveBody("build", [command("note", "echo {{item.title}}")]);
		const items = Array.from({ length: 30 }, (_, i) => ({
			id: String(i + 1),
			title: `element ${i + 1}`,
		}));
		const engine = makeEngine(fakeHarness());
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				callEach("loop", "build", "", {
					source: { kind: "json", value: JSON.stringify(items) },
					branch: "shared",
				}),
			]),
		});
		const detail = await waitFor(
			async () => {
				const found = await engine.getRun(started.id);
				return found.status === "running" ? null : found;
			},
			{ label: "the loop to end", timeoutMs: 60_000 },
		);
		expect(detail.status).toBe("finished");
		expect(detail.reason).toBeNull();
		expect(detail.resumes).toEqual([]);
		const loop = callEachStep(detail);
		expect(loop.outcome).toBe("done");
		expect(loop.items.map((i) => i.state)).toEqual(Array(30).fill("done"));
		expect(detail.steps.filter((s) => s.nodeId === "note")).toHaveLength(30);
		// One walk, ended once.
		const logged = await loggedEvents(started.id);
		expect(logged.filter((e) => e.type === "RunEnded")).toHaveLength(1);
	});
});

describe("run policy", () => {
	const MINUTE = 20;

	test("a usage limit with a reset time sleeps, then continues the same harness session", async () => {
		const harness = fakeHarness((_input, call) =>
			call === 0 ? usageLimitScript(Date.now() + 2 * MINUTE) : {},
		);
		const engine = makeEngine(harness, {}, { minuteMs: MINUTE });
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", "Go")]),
		});
		const sleeping = await waitForStatus(engine, started.id, "sleeping");
		// The reset time, not a fixed delay: a busy machine may reach it already.
		expect(sleeping.wakeAt).toBeGreaterThan(started.createdAt);
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("finished");
		expect(detail.wakeAt).toBeNull();
		expect(harness.calls).toHaveLength(2);
		expect(harness.calls[1]?.resumeSessionId).toBe("fake-session-1");
		expect(harness.calls[1]?.prompt).toBe("Continue where you left off.");
		const [worker] = detail.steps;
		expect(detail.steps).toHaveLength(1);
		expect(worker?.outcome).toBe("pass");
		expect(worker?.sessions.map((s) => s.outcome)).toEqual([
			"failed",
			"finished",
		]);
		const kinds = (await readTranscript(started.id, worker?.id ?? "")).map(
			(e) => e.event.type,
		);
		expect(kinds).toContain("wait");
		expect(kinds.indexOf("wake")).toBeGreaterThan(kinds.indexOf("wait"));
		const waits = (await loggedEvents(started.id)).filter(
			(e) => e.type === "WaitStarted",
		);
		expect(waits[0]?.payload.reason).toBe("usage-limit");
	});

	test("a usage limit without a reset time backs off, doubling each time", async () => {
		const harness = fakeHarness((_input, call) =>
			call < 2 ? usageLimitScript() : {},
		);
		const engine = makeEngine(harness, {}, { minuteMs: 5 });
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", "Go")], [], {
				policy: {
					usageLimitFirstWaitMinutes: 2,
					usageLimitMaxWaitMinutes: 60,
					networkGraceMinutes: 240,
				},
			}),
		});
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("finished");
		expect(harness.calls.map((c) => c.resumeSessionId)).toEqual([
			undefined,
			"fake-session-1",
			"fake-session-1",
		]);
		const waits = (await loggedEvents(started.id)).filter(
			(e) => e.type === "WaitStarted",
		);
		expect(waits.map((w) => w.payload.message)).toEqual([
			expect.stringContaining("continues in 2 min"),
			expect.stringContaining("continues in 4 min"),
		]);
	});

	test("a network failure backs off until the grace is spent, then the step errors", async () => {
		const harness = fakeHarness({
			steps: [],
			delayMs: 1,
			outcome: {
				type: "error",
				kind: "network",
				message: "connection refused",
			},
		});
		const engine = makeEngine(harness, {}, { minuteMs: 100 });
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", "Go")], [], {
				policy: {
					usageLimitFirstWaitMinutes: 5,
					usageLimitMaxWaitMinutes: 60,
					networkGraceMinutes: 4,
				},
			}),
		});
		const detail = await waitFor(
			async () => {
				const d = await engine.getRun(started.id);
				return d.status === "failed" ? d : null;
			},
			{ label: "the run to fail" },
		);
		expect(harness.calls).toHaveLength(3);
		expect(harness.calls[2]?.resumeSessionId).toBe("fake-session-1");
		const waits = (await loggedEvents(started.id)).filter(
			(e) => e.type === "WaitStarted",
		);
		expect(waits.map((w) => w.payload.message)).toEqual([
			expect.stringContaining("continues in 1 min"),
			expect.stringContaining("continues in 2 min"),
		]);
		expect(detail.steps[0]?.outcome).toBe("error");
		expect(detail.steps[0]?.error).toContain("grace of 4 min");
		expect(detail.reason).toContain("connection refused");
	});

	test("a Decision that hits a usage limit sleeps and decides again", async () => {
		const decider = fakeDecider([
			{
				kind: "error",
				errorKind: "usage-limit",
				message: "limit",
				costUsd: null,
			},
			{ label: "yes" },
		]);
		const engine = makeEngine(fakeHarness(), { decider }, { minuteMs: 2 });
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([{ ...decision("ask", ["yes", "no"]), prompt: "Ok?" }]),
		});
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("finished");
		expect(decider.calls).toHaveLength(2);
		expect(detail.steps).toHaveLength(1);
		expect(detail.steps[0]?.outcome).toBe("yes");
	});

	test("a sleep survives a restart: the new daemon rebuilds the timer and wakes the step inside its item", async () => {
		await saveBody("build", [agent("worker", "Build {{item.title}}")]);
		const first = fakeHarness(usageLimitScript());
		const dying = new AbortController();
		// Five real minutes: this daemon never wakes it.
		const engine1 = makeEngine(first, {}, { signal: dying.signal });
		const started = await engine1.startRun({
			projectId: await projectId(engine1),
			flow: flowOf([
				callEach("loop", "build", printItems([{ id: "1", title: "a" }]), {
					branch: "shared",
				}),
			]),
		});
		const sleeping = await waitForStatus(engine1, started.id, "sleeping");
		expect(callEachStep(sleeping).endedAt).toBeNull();
		dying.abort();

		// A new daemon, ten minutes later.
		const second = fakeHarness();
		const engine2 = makeEngine(
			second,
			{},
			{ now: () => Date.now() + 10 * 60_000 },
		);
		const detail = await waitForEnd(engine2, started.id);
		expect(detail.status).toBe("finished");
		expect(second.calls[0]?.resumeSessionId).toBe("fake-session-1");
		expect(callEachStep(detail).items.map((i) => i.state)).toEqual(["done"]);
		expect(detail.steps.filter((s) => s.nodeId === "worker")).toHaveLength(1);
	});

	test("stop ends a sleep; resume wakes a sleeping run at once", async () => {
		const harness = fakeHarness((_input, call) =>
			call < 2 ? usageLimitScript() : {},
		);
		const engine = makeEngine(harness);
		const id = await projectId(engine);
		const a = await engine.startRun({
			projectId: id,
			flow: flowOf([agent("worker", "Go")]),
		});
		await waitForStatus(engine, a.id, "sleeping");
		await engine.stopRun(a.id);
		const stopped = await engine.getRun(a.id);
		expect(stopped.status).toBe("stopped");
		expect(stopped.wakeAt).toBeNull();
		expect(stopped.steps[0]?.outcome).toBe("stopped");

		const before = harness.calls.length;
		const b = await engine.startRun({
			projectId: id,
			flow: flowOf([agent("worker", "Go")]),
		});
		await waitForStatus(engine, b.id, "sleeping");
		await engine.resumeRun(b.id, "Go on now.");
		const detail = await waitForEnd(engine, b.id);
		expect(detail.status).toBe("finished");
		const resumed = harness.calls[before + 1];
		expect(resumed?.prompt).toBe("Go on now.");
		expect(resumed?.resumeSessionId).toBeDefined();
		const wakes = (await loggedEvents(b.id)).filter(
			(e) => e.type === "WaitEnded",
		);
		expect(wakes.map((w) => w.payload.early)).toEqual([true]);
	});

	test("an Agent step with no activity for idleMinutes errors", async () => {
		const harness = fakeHarness({
			steps: [{ type: "wait", ms: 500 }],
		});
		const engine = makeEngine(harness, {}, { minuteMs: 20 });
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([agent("worker", "Go", { idleMinutes: 2 })]),
		});
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("failed");
		expect(detail.steps[0]?.error).toBe("No activity for 2 min.");
	});
});

describe("stop modes", () => {
	test("stop after-step lets the running step finish, then stops before the next", async () => {
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[agent("worker", "Go"), command("check", "true")],
				[edge("e1", "worker", "pass", "check")],
			),
		});
		const session = await waitFor(() => sessions[0]);
		await engine.stopRun(started.id, { when: "after-step" });
		const asked = await engine.getRun(started.id);
		expect(asked.status).toBe("running");
		expect(asked.stopAfterStep).toBe(true);
		session.finish();
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("stopped");
		expect(detail.reason).toBe("Stopped after the running step, as asked.");
		expect(detail.stopAfterStep).toBe(false);
		expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["worker", "pass"],
		]);

		// Resume continues where it stopped, without the old request.
		await engine.resumeRun(started.id);
		expect((await waitForEnd(engine, started.id)).status).toBe("finished");
	});

	test("stop after-step inside a For Each stops before the next item", async () => {
		await saveBody("build", [agent("worker", "Build {{item.title}}")]);
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				callEach(
					"loop",
					"build",
					printItems([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
					]),
					{ branch: "shared" },
				),
			]),
		});
		const session = await waitFor(() => sessions[0]);
		await engine.stopRun(started.id, { when: "after-step" });
		session.finish();
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("stopped");
		expect(callEachStep(detail).items.map((i) => [i.id, i.state])).toEqual([
			["1", "done"],
		]);
		expect(sessions).toHaveLength(1);
	});

	test("stop after-step in the middle of an item: the item no longer shows running, and resume continues it", async () => {
		await saveBody(
			"build",
			[agent("worker", "Build {{item.title}}"), command("check", "true")],
			[edge("b1", "worker", "pass", "check")],
		);
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const started = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf([
				callEach(
					"loop",
					"build",
					printItems([
						{ id: "1", title: "a" },
						{ id: "2", title: "b" },
					]),
					{ branch: "shared" },
				),
			]),
		});
		const session = await waitFor(() => sessions[0]);
		await engine.stopRun(started.id, { when: "after-step" });
		session.finish();
		const stopped = await waitForEnd(engine, started.id);
		expect(stopped.status).toBe("stopped");
		expect(stopped.reason).toBe("Stopped after the running step, as asked.");
		const loop = callEachStep(stopped);
		expect(loop.outcome).toBe("stopped");
		expect(loop.items.map((i) => [i.id, i.state, i.reason])).toEqual([
			["1", "failed", "The run stopped during this item."],
		]);

		await engine.resumeRun(started.id);
		const second = await waitFor(() => sessions[1]);
		expect(second.input.prompt).toBe("Build b");
		second.finish();
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("finished");
		expect(
			detail.steps.map((s) => [s.nodeId, s.scope?.itemId ?? null, s.outcome]),
		).toEqual([
			["loop", null, "done"],
			["worker", "1", "pass"],
			["check", "1", "pass"],
			["worker", "2", "pass"],
			["check", "2", "pass"],
		]);
		expect(callEachStep(detail).items.map((i) => [i.id, i.state])).toEqual([
			["1", "done"],
			["2", "done"],
		]);
	});

	test("the stop time ends the run before the next step, never during one", async () => {
		let clock = Date.now();
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness, {}, { now: () => clock });
		const stopAt = clock + 60_000;
		const started = await engine.startRun({
			projectId: await projectId(engine),
			stopAt,
			flow: flowOf(
				[agent("worker", "Go"), command("check", "true")],
				[edge("e1", "worker", "pass", "check")],
			),
		});
		expect(started.stopAt).toBe(stopAt);
		const session = await waitFor(() => sessions[0]);
		clock = stopAt + 1;
		await Bun.sleep(20);
		expect((await engine.getRun(started.id)).status).toBe("running");
		session.finish();
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("stopped");
		expect(detail.reason).toBe("Reached the stop time");
		expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["worker", "pass"],
		]);

		// A person resumes past the stop time: it no longer applies.
		await engine.resumeRun(started.id);
		const resumed = await waitForEnd(engine, started.id);
		expect(resumed.status).toBe("finished");
		expect(resumed.stopAt).toBeNull();
		await expect(
			engine.startRun({
				projectId: started.projectId,
				stopAt: clock - 1,
				flow: flowOf([command("check", "true")]),
			}),
		).rejects.toThrow("stop time has passed");
	});

	test("a usage limit that resets after the stop time stops the run at once; resume continues the same session", async () => {
		const clock = Date.now();
		const stopAt = clock + 60 * 60_000;
		const harness = fakeHarness((_input, call) =>
			call === 0 ? usageLimitScript(stopAt) : {},
		);
		const engine = makeEngine(harness, {}, { now: () => clock });
		const started = await engine.startRun({
			projectId: await projectId(engine),
			stopAt,
			flow: flowOf(
				[agent("worker", "Go"), command("check", "true")],
				[edge("e1", "worker", "pass", "check")],
			),
		});
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("stopped");
		expect(detail.reason).toBe(
			"Usage limit: You've hit your limit. It resets after the stop time, so the run stopped. Resume the run to continue.",
		);
		expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["worker", "stopped"],
		]);
		const logged = await loggedEvents(started.id);
		expect(logged.some((e) => e.type === "WaitStarted")).toBe(false);

		await engine.resumeRun(started.id);
		const resumed = await waitForEnd(engine, started.id);
		expect(resumed.status).toBe("finished");
		expect(harness.calls).toHaveLength(2);
		expect(harness.calls[1]?.resumeSessionId).toBe("fake-session-1");
		expect(resumed.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
			["worker", "pass"],
			["check", "pass"],
		]);
	});

	test("a usage limit that resets before the stop time still waits", async () => {
		const clock = Date.now();
		const harness = fakeHarness((_input, call) =>
			call === 0 ? usageLimitScript(clock + 60_000) : {},
		);
		const engine = makeEngine(harness, {}, { now: () => clock });
		const started = await engine.startRun({
			projectId: await projectId(engine),
			stopAt: clock + 60 * 60_000,
			flow: flowOf([agent("worker", "Go")]),
		});
		const sleeping = await waitForStatus(engine, started.id, "sleeping");
		expect(sleeping.wakeAt).toBe(clock + 2 * 60_000);
		await engine.stopRun(started.id);
		await waitForEnd(engine, started.id);
	});

	test("the stop time takes a Call's stopped edge: the item ends failed, and the nodes after it run past the stop time", async () => {
		await saveBody(
			"build",
			[agent("worker", "Build {{item.id}}"), command("commit", commitItem)],
			[edge("b1", "worker", "pass", "commit")],
		);
		let clock = Date.now();
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness, {}, { now: () => clock });
		const stopAt = clock + 60_000;
		const started = await engine.startRun({
			projectId: await projectId(engine),
			stopAt,
			flow: flowOf(
				[
					callEach("loop", "build", printItems([{ id: "1" }, { id: "2" }])),
					command("report", `printf '%s' "{{loop.summary}}"`),
				],
				[
					edge("e1", "loop", "done", "report"),
					edge("e2", "loop", "stopped", "report"),
				],
			),
		});
		const session = await waitFor(() => sessions[0]);
		clock = stopAt + 1;
		session.finish();
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("finished");
		expect(
			detail.steps.map((s) => [s.nodeId, s.scope?.itemId ?? null, s.outcome]),
		).toEqual([
			["loop", null, "stopped"],
			["worker", "1", "pass"],
			["report", null, "pass"],
		]);
		expect(
			callEachStep(detail).items.map((i) => [i.id, i.state, i.reason]),
		).toEqual([["1", "failed", "Not finished before the stop time."]]);
		// The stop time cut the item: it counts as stopped, not failed.
		const [listed] = await engine.listRuns();
		expect(listed?.subflows.map((s) => [s.flowName, s.status])).toEqual([
			["build", "stopped"],
		]);
		const report = detail.steps.find((s) => s.nodeId === "report");
		expect(report?.outputs?.log_tail).toBe(
			"#1 failed: Not finished before the stop time.\n#2 not started",
		);
	});

	test("without a stopped edge, the stop time inside a Call still stops the run there", async () => {
		await saveBody("build", [agent("worker", "Build {{item.id}}")]);
		let clock = Date.now();
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness, {}, { now: () => clock });
		const stopAt = clock + 60_000;
		const started = await engine.startRun({
			projectId: await projectId(engine),
			stopAt,
			flow: flowOf(
				[
					callEach("loop", "build", printItems([{ id: "1" }, { id: "2" }])),
					command("report", "true"),
				],
				[edge("e1", "loop", "done", "report")],
			),
		});
		const session = await waitFor(() => sessions[0]);
		clock = stopAt + 1;
		session.finish();
		const detail = await waitForEnd(engine, started.id);
		expect(detail.status).toBe("stopped");
		expect(detail.reason).toBe("Reached the stop time");
		expect(detail.steps.some((s) => s.nodeId === "report")).toBe(false);
	});
});

describe("run inputs", () => {
	test("inputs reach top-level templates, bindings reach the called flow, defaults apply", async () => {
		const engine = makeEngine(fakeHarness());
		const dir = join(sandbox.repoPath, ".nightshift", "flows");
		await mkdir(dir, { recursive: true });
		const body: FlowInput = {
			...flowOf([
				command("note", `echo "body sees epic {{epic}} for {{item.id}}"`),
			]),
			inputs: [
				{ name: "item", type: "json", required: true },
				{ name: "epic", required: true },
			],
		};
		await writeFile(join(dir, "body.json"), JSON.stringify(body));
		const flow = flowOf(
			[
				command("hello", `echo "epic {{epic}} model {{model}}"`),
				callEach("loop", "body", printItems([{ id: "1", title: "a" }]), {
					branch: "shared",
					inputs: { epic: "{{epic}}" },
				}),
			],
			[edge("e1", "hello", "pass", "loop")],
			{
				inputs: [
					{ name: "epic", type: "text", required: true },
					{ name: "model", type: "text", default: "sonnet" },
				],
			},
		);
		const id = await projectId(engine);

		await expect(engine.startRun({ projectId: id, flow })).rejects.toThrow(
			"The flow needs a value for: epic.",
		);
		await expect(
			engine.startRun({ projectId: id, flow, inputs: { nope: "x" } }),
		).rejects.toThrow('The flow has no input "nope".');

		const run = await engine.startRun({
			projectId: id,
			flow,
			inputs: { epic: " 1097 " },
		});
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("finished");
		expect(detail.inputs).toEqual({ epic: "1097", model: "sonnet" });
		const outputs = detail.steps.map((s) => s.outputs.log_tail);
		expect(outputs).toContain("epic 1097 model sonnet");
		expect(outputs).toContain("body sees epic 1097 for 1");
	});
});
