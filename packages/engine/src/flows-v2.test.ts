import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	fakeDecider,
	fakeHarness,
	reportingScript,
} from "@nightshift/agents/fake";
import type { AgentHarness, AgentSessionInput } from "@nightshift/agents/types";
import type {
	AgentNode,
	CallEach,
	CallEachNode,
	CallNode,
	CommandNode,
	Flow,
	FlowEdge,
	FlowInput,
} from "@nightshift/flows";

import { createEngine } from "./engine";
import { appendEvent } from "./events";
import { saverFor } from "./graph/checkpointer";
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
import type { Engine, RunDetail, StepSummary } from "./types";

/**
 * Flow format 2: inputs and outputs, templates with paths, the Call
 * node (once, and over any list), Agent outcomes and output schemas, and
 * runs and flow files of format 1.
 */

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
	options: Partial<Pick<TestEngineOptions, "decider">> = {},
): Engine {
	const runLog = createRunLog(sandbox.db);
	runLogs.push(runLog);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": harness },
			dataDir: sandbox.dataDir,
			// The format 1 flows had the GitHub tool set: now the CLI tool gh.
			cliNames: () => new Set(["gh"]),
			findCli: (name) => `/usr/local/bin/${name}`,
			...options,
		}),
		{ runLog },
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

function callOnce(
	id: string,
	flow: string,
	inputs: Record<string, string> = {},
): CallNode {
	return { id, type: "call", position: { x: 0, y: 0 }, flow, inputs };
}

/** A Call node with `each`: `extra` fills `each`, except `inputs` and `timeoutMinutes`. */
function callEach(
	id: string,
	flow: string,
	source: CallEach["source"],
	extra: Partial<CallEach> &
		Partial<Pick<CallNode, "inputs" | "timeoutMinutes">> = {},
): CallEachNode {
	const { inputs, timeoutMinutes, ...each } = extra;
	return {
		id,
		type: "call",
		position: { x: 0, y: 0 },
		flow,
		inputs: inputs ?? {},
		...(timeoutMinutes === undefined ? {} : { timeoutMinutes }),
		each: { source, as: "item", branch: "shared", haltOn: ["halt"], ...each },
	};
}

function edge(id: string, from: string, outcome: string, to: string): FlowEdge {
	return { id, from, outcome, to };
}

function flowOf(
	nodes: Flow["nodes"],
	edges: FlowEdge[] = [],
	extra: Partial<Flow> = {},
): Flow {
	return {
		version: 4,
		inputs: [],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges,
		...extra,
	};
}

async function saveFlow(name: string, flow: FlowInput | unknown) {
	const dir = join(sandbox.repoPath, ".nightshift", "flows");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, `${name}.json`), JSON.stringify(flow));
}

async function projectId(engine: Engine): Promise<string> {
	return (await engine.addProject({ repoPath: sandbox.repoPath })).id;
}

async function waitForEnd(engine: Engine, runId: string): Promise<RunDetail> {
	return waitFor(
		async () => {
			const detail = await engine.getRun(runId);
			const open = ["running", "sleeping", "waiting"].includes(detail.status);
			return open ? null : detail;
		},
		{ label: "the run to end" },
	);
}

const stepOf = (detail: RunDetail, nodeId: string): StepSummary => {
	const found = detail.steps.findLast((s) => s.nodeId === nodeId);
	if (!found) throw new Error(`No step ${nodeId}`);
	return found;
};

const logOf = (detail: RunDetail, nodeId: string) =>
	stepOf(detail, nodeId).outputs.log_tail;

/** A harness whose sessions report what `script` returns for each prompt. */
function reportingHarness(
	script: (
		input: AgentSessionInput,
		call: number,
	) => {
		outcome?: string;
		data?: unknown;
		summary?: string;
	} | null,
) {
	return fakeHarness((input, call) => {
		const report = script(input, call);
		if (!report) return { steps: [{ type: "text", text: "No report." }] };
		return {
			...reportingScript(
				report.outcome ?? "pass",
				report.summary ?? `report ${call}`,
				report.data,
			),
			delayMs: 1,
		};
	});
}

describe("inputs at start", () => {
	const flow = flowOf(
		[
			command(
				"show",
				`echo "{{epic}} {{config.retries}} {{tasks.0.id}} {{tasks}}"`,
			),
		],
		[],
		{
			inputs: [
				{ name: "epic", type: "text", label: "Epic", required: true },
				{ name: "config", type: "json", default: '{"retries": 2}' },
				{ name: "tasks", type: "json" },
				{ name: "note", type: "text" },
			],
		},
	);

	test("text and json values, defaults, and the title", async () => {
		await saveFlow("show", flow);
		const engine = makeEngine(fakeHarness());
		const id = await projectId(engine);

		const run = await engine.startRun({
			projectId: id,
			flowName: "show",
			inputs: { epic: " 12 ", tasks: '[{"id": "a"}]' },
		});
		expect(run.title).toBe("show · epic 12");
		expect(run.inputs).toEqual({
			epic: "12",
			config: { retries: 2 },
			tasks: [{ id: "a" }],
			note: "",
		});
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("finished");
		expect(logOf(detail, "show")).toBe('12 2 a [{"id":"a"}]');

		// A JSON value works as well as JSON text; an empty value takes the default.
		const second = await engine.startRun({
			projectId: id,
			flowName: "show",
			inputs: { epic: "13", tasks: [{ id: "b" }], config: "" },
		});
		const done = await waitForEnd(engine, second.id);
		expect(done.inputs).toMatchObject({
			config: { retries: 2 },
			tasks: [{ id: "b" }],
		});
		expect(logOf(done, "show")).toBe('13 2 b [{"id":"b"}]');
	});

	test("refuses a missing required input, unknown names and bad JSON", async () => {
		const engine = makeEngine(fakeHarness());
		const id = await projectId(engine);
		await expect(engine.startRun({ projectId: id, flow })).rejects.toThrow(
			"The flow needs a value for: Epic.",
		);
		await expect(
			engine.startRun({ projectId: id, flow, inputs: { epic: "1", x: "2" } }),
		).rejects.toThrow('The flow has no input "x".');
		await expect(
			engine.startRun({
				projectId: id,
				flow,
				inputs: { epic: "1", tasks: "[not json" },
			}),
		).rejects.toThrow('The value of input "tasks" is not valid JSON');
		const badDefault = flowOf([command("a", "true")], [], {
			inputs: [{ name: "cfg", type: "json", default: "{nope" }],
		});
		await expect(
			engine.startRun({ projectId: id, flow: badDefault }),
		).rejects.toThrow('input "cfg" is not valid JSON');
		expect(await engine.listRuns()).toEqual([]);
	});
});

describe("Call", () => {
	test("binds inputs, runs the called flow in its own scope, and returns its outputs", async () => {
		await saveFlow(
			"greet",
			flowOf(
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
			),
		);
		const engine = makeEngine(fakeHarness());
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
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
		});
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("finished");
		expect(Object.keys(detail.calledFlows)).toEqual(["greet"]);
		const sub = stepOf(detail, "sub");
		expect(sub.nodeType).toBe("call");
		expect(sub.outcome).toBe("pass");
		expect(sub.outputs).toEqual({
			greeting: "hi bob 0",
			count: 0,
			mood: "glad",
			ended: "",
			outcome: "pass",
			visit: 1,
		});
		expect(logOf(detail, "after")).toBe("hi bob 0|0|glad||pass");
		expect(stepOf(detail, "hello").scope).toEqual({
			parentStepId: sub.id,
			itemId: null,
		});
		expect(logOf(detail, "where")).toBe("greet .");
	});

	test("a called flow that fails makes the Subflow fail; an Agent's own outcome is `ended`", async () => {
		await saveFlow(
			"broken",
			flowOf([command("boom", "echo broke; exit 3")], [], {
				outputs: [{ name: "why", value: "{{boom.log_tail}}" }],
			}),
		);
		await saveFlow(
			"review",
			flowOf([
				agent("judge", "Judge it", {
					outcomes: [{ name: "approved" }, { name: "rejected" }],
				}),
			]),
		);
		const engine = makeEngine(
			reportingHarness(() => ({ outcome: "approved" })),
		);
		const id = await projectId(engine);
		const run = await engine.startRun({
			projectId: id,
			flow: flowOf(
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
		});
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("finished");
		const tried = stepOf(detail, "try");
		expect(tried.outcome).toBe("fail");
		expect(tried.error).toContain('Node "boom" ended with "fail"');
		expect(logOf(detail, "cleanup")).toBe("fail broke");
		expect(stepOf(detail, "ask").outputs.ended).toBe("approved");
		expect(logOf(detail, "verdict")).toBe("approved");

		// Without an edge on `fail`, the run fails.
		const failing = await engine.startRun({
			projectId: id,
			flow: flowOf([callOnce("try", "broken")]),
		});
		const failed = await waitForEnd(engine, failing.id);
		expect(failed.status).toBe("failed");
		expect(failed.reason).toContain('Node "try" ended with "fail"');
	});

	test("an input binding that refuses is a step error", async () => {
		await saveFlow(
			"needs",
			flowOf([command("a", "true")], [], {
				inputs: [{ name: "must", type: "text", required: true }],
			}),
		);
		const engine = makeEngine(fakeHarness());
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					command("empty", "true"),
					callOnce("call", "needs", { must: "{{empty.log_tail}}" }),
				],
				[edge("e1", "empty", "pass", "call")],
			),
		});
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("failed");
		const call = stepOf(detail, "call");
		expect(call.outcome).toBe("error");
		expect(call.error).toBe('The flow "needs" needs a value for: must.');
	});

	test("nested Subflows pass outputs up through every level", async () => {
		await saveFlow(
			"leaf",
			flowOf([command("calc", `echo "leaf of {{n}}"`)], [], {
				inputs: [{ name: "n", type: "json", required: true }],
				outputs: [
					{ name: "value", value: "{{calc.log_tail}}" },
					{ name: "doubled", value: "{{n.list}}" },
				],
			}),
		);
		await saveFlow(
			"mid",
			flowOf([callOnce("inner", "leaf", { n: "{{payload}}" })], [], {
				inputs: [{ name: "payload", type: "json", required: true }],
				outputs: [
					{ name: "value", value: "{{inner.value}}" },
					{ name: "list", value: "{{inner.doubled}}" },
				],
			}),
		);
		const engine = makeEngine(fakeHarness());
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					callOnce("outer", "mid", { payload: '{"list": [1, 2]}' }),
					command("end", `echo "{{outer.value}} / {{outer.list.1}}"`),
				],
				[edge("e1", "outer", "pass", "end")],
			),
		});
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("finished");
		expect(Object.keys(detail.calledFlows).sort()).toEqual(["leaf", "mid"]);
		expect(stepOf(detail, "outer").outputs.list).toEqual([1, 2]);
		expect(logOf(detail, "end")).toBe('leaf of {"list":[1,2]} / 2');
		const outer = stepOf(detail, "outer");
		const inner = stepOf(detail, "inner");
		expect(inner.scope).toEqual({ parentStepId: outer.id, itemId: null });
		expect(stepOf(detail, "calc").scope).toEqual({
			parentStepId: inner.id,
			itemId: null,
		});
	});

	test("a Gate inside a called flow waits, and its answer continues the caller", async () => {
		await saveFlow(
			"ask",
			flowOf(
				[
					{
						id: "gate",
						type: "decision",
						position: { x: 0, y: 0 },
						prompt: "Ship {{what}}?",
						options: [{ name: "yes" }, { name: "no" }],
						by: "person",
						decider: "typesafe",
					},
				],
				[],
				{
					inputs: [{ name: "what", type: "text", required: true }],
					outputs: [{ name: "note", value: "{{gate.note}}" }],
				},
			),
		);
		const engine = makeEngine(fakeHarness());
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					callOnce("call", "ask", { what: "it" }),
					command("after", `echo "{{call.ended}} {{call.note}}"`),
				],
				[edge("e1", "call", "pass", "after")],
			),
		});
		const gate = await waitFor(async () => (await engine.listGates())[0]);
		expect(gate.question).toBe("Ship it?");
		expect((await engine.getRun(run.id)).status).toBe("waiting");
		await engine.resolveGate({
			runId: run.id,
			stepId: gate.stepId,
			choice: "yes",
			note: "go",
		});
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("finished");
		expect(logOf(detail, "after")).toBe("yes go");
		expect(detail.steps.filter((s) => s.nodeId === "call")).toHaveLength(1);
	});

	test("stop inside a called flow, then resume continues there", async () => {
		await saveFlow(
			"work",
			flowOf([agent("worker", "Work on {{topic}}")], [], {
				inputs: [{ name: "topic", type: "text", required: true }],
				outputs: [{ name: "said", value: "{{worker.output}}" }],
			}),
		);
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					callOnce("call", "work", { topic: "trees" }),
					command("after", `echo "{{call.said}}"`),
				],
				[edge("e1", "call", "pass", "after")],
			),
		});
		await waitFor(() => sessions[0]);
		expect(sessions[0]?.input.prompt).toBe("Work on trees");
		await engine.stopRun(run.id);
		const stopped = await engine.getRun(run.id);
		expect(stopped.status).toBe("stopped");
		expect(stepOf(stopped, "call").outcome).toBe("stopped");

		await engine.resumeRun(run.id, "Go on.");
		await waitFor(() => sessions[1]);
		expect(sessions[1]?.input.resumeSessionId).toBe("harness-0");
		sessions[1]?.text("done with trees");
		sessions[1]?.finish();
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("finished");
		expect(logOf(detail, "after")).toBe("done with trees");
		// The same Subflow step and the same worker step continued.
		expect(detail.steps.filter((s) => s.nodeId === "call")).toHaveLength(1);
		expect(detail.steps.filter((s) => s.nodeId === "worker")).toHaveLength(1);
	});

	test("a run whose thread has no checkpoint (from before this engine) resumes from the log: the stopped step goes on, a later Subflow starts a new visit, templates and edge counts hold", async () => {
		await saveFlow(
			"sub",
			flowOf([command("say", `echo "note={{note}}"`)], [], {
				inputs: [{ name: "note", type: "text", required: true }],
			}),
		);
		const { harness, sessions } = scriptedHarness();
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					agent("plan", "Plan it"),
					callOnce("call", "sub", { note: "exit {{check.exit_code}}" }),
					command("check", "exit 1"),
				],
				[
					edge("e1", "plan", "pass", "call"),
					edge("e2", "call", "pass", "check"),
					{ id: "e3", from: "check", outcome: "fail", to: "plan", max: 1 },
				],
			),
		});
		(await waitFor(() => sessions[0])).finish();
		// check fails and e3 leads back to plan, whose second visit is stopped.
		await waitFor(() => sessions[1]);
		await engine.stopRun(run.id);
		const stopped = await engine.getRun(run.id);
		expect(stopped.status).toBe("stopped");
		expect(
			stopped.steps
				.filter((s) => s.scope === null)
				.map((s) => [s.nodeId, s.visit, s.outcome]),
		).toEqual([
			["plan", 1, "pass"],
			["call", 1, "pass"],
			["check", 1, "fail"],
			["plan", 2, "stopped"],
		]);

		// The previous engine walked this run: its thread has no checkpoint.
		await saverFor(sandbox.db).deleteThread(run.id);

		await engine.resumeRun(run.id, "Go on.");
		const resumed = await waitFor(() => sessions[2]);
		expect(resumed.input.resumeSessionId).toBe("harness-1");
		expect(resumed.input.prompt).toBe("Go on.");
		resumed.finish();
		const detail = await waitForEnd(engine, run.id);
		// check failed again, and e3 had been taken once before the resume.
		expect(detail.status).toBe("failed");
		expect(detail.reason).toContain('edge "e3"');
		expect(detail.reason).toContain("reached its max");
		expect(sessions).toHaveLength(3);
		const top = detail.steps.filter((s) => s.scope === null);
		expect(top.map((s) => [s.nodeId, s.visit, s.outcome])).toEqual([
			["plan", 1, "pass"],
			["call", 1, "pass"],
			["check", 1, "fail"],
			["plan", 2, "pass"],
			["call", 2, "pass"],
			["check", 2, "fail"],
		]);
		expect(top[3]?.sessions.map((s) => s.outcome)).toEqual([
			"stopped",
			"finished",
		]);
		// The Subflow's second visit bound check's output from the log.
		expect(
			detail.steps
				.filter((s) => s.nodeId === "say")
				.map((s) => s.outputs.log_tail),
		).toEqual(["note=exit", "note=exit 1"]);
		expect(detail.traversals).toEqual({ e1: 2, e2: 2, e3: 1 });
	});
});

describe("Call with each, over any list", () => {
	test("a planner's data feeds a For Each; `as`, bindings, run fields and `results`", async () => {
		await saveFlow(
			"task",
			flowOf(
				[agent("work", "Do {{task.title}} ({{task.id}}) for {{goal}}")],
				[],
				{
					inputs: [
						{ name: "task", type: "json", required: true },
						{ name: "goal", type: "text" },
					],
					outputs: [
						{ name: "result", value: "{{work.data}}" },
						{
							name: "label",
							value: "{{task.title}} at {{run.index}} on {{run.branch}}",
						},
					],
				},
			),
		);
		const harness = reportingHarness((input, call) =>
			call === 0
				? {
						summary: "the plan",
						data: {
							tasks: [
								{ id: "t1", title: "One" },
								{ id: "t2", title: "Two", dependsOn: ["t1"] },
							],
						},
					}
				: { data: { did: input.prompt } },
		);
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					agent("planner", "Plan", {
						output: {
							type: "object",
							required: ["tasks"],
							properties: { tasks: { type: "array" } },
						},
					}),
					callEach(
						"each",
						"task",
						{ kind: "json", value: "{{planner.data.tasks}}" },
						{ as: "task", inputs: { goal: "{{planner.summary}}" } },
					),
					command("report", `echo "{{each.results.1.outputs.label}}"`),
				],
				[
					edge("e1", "planner", "pass", "each"),
					edge("e2", "each", "done", "report"),
				],
			),
		});
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("finished");
		expect(harness.calls.map((c) => c.prompt)).toEqual([
			"Plan",
			"Do One (t1) for the plan",
			"Do Two (t2) for the plan",
		]);
		expect(harness.calls[0]?.stepReport).toEqual({
			output: {
				type: "object",
				required: ["tasks"],
				properties: { tasks: { type: "array" } },
			},
		});
		expect(harness.calls[1]?.stepReport).toBe(true);
		const each = stepOf(detail, "each");
		expect(each.items.map((i) => [i.id, i.title, i.state, i.value])).toEqual([
			["t1", "One", "done", { id: "t1", title: "One" }],
			["t2", "Two", "done", { id: "t2", title: "Two", dependsOn: ["t1"] }],
		]);
		const branch = detail.branch;
		expect(each.outputs.results).toEqual([
			{
				id: "t1",
				title: "One",
				state: "done",
				reason: null,
				outputs: {
					result: { did: "Do One (t1) for the plan" },
					label: `One at 0 on ${branch}`,
				},
			},
			{
				id: "t2",
				title: "Two",
				state: "done",
				reason: null,
				outputs: {
					result: { did: "Do Two (t2) for the plan" },
					label: `Two at 1 on ${branch}`,
				},
			},
		]);
		expect(logOf(detail, "report")).toBe(`Two at 1 on ${branch}`);
		expect(stepOf(detail, "work").scope).toEqual({
			parentStepId: each.id,
			itemId: "t2",
		});
	});

	test("files that match a glob, sorted, and a glob that leaves the worktree", async () => {
		for (const name of ["src/b.ts", "src/a.ts", "src/c.md", "top.ts"]) {
			await mkdir(join(sandbox.repoPath, "src"), { recursive: true });
			await writeFile(join(sandbox.repoPath, name), `${name}\n`);
		}
		await mustGit(sandbox.repoPath, ["add", "-A"]);
		await mustGit(sandbox.repoPath, [
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@nightshift.invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-q",
			"-m",
			"files",
		]);
		await saveFlow(
			"lint",
			flowOf([command("look", `head -c 8 "{{item.path}}"`)], [], {
				inputs: [{ name: "item", type: "json", required: true }],
			}),
		);
		const engine = makeEngine(fakeHarness());
		const id = await projectId(engine);
		const flow = flowOf(
			[callEach("files", "lint", { kind: "files", glob: "{{pattern}}" })],
			[],
			{
				inputs: [{ name: "pattern", type: "text", default: "src/*.ts" }],
			},
		);
		const run = await engine.startRun({ projectId: id, flow });
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("finished");
		const files = stepOf(detail, "files");
		expect(files.items.map((i) => [i.id, i.title, i.value])).toEqual([
			[
				"src/a.ts",
				"src/a.ts",
				{ id: "src/a.ts", title: "src/a.ts", path: "src/a.ts" },
			],
			[
				"src/b.ts",
				"src/b.ts",
				{ id: "src/b.ts", title: "src/b.ts", path: "src/b.ts" },
			],
		]);
		expect(
			detail.steps
				.filter((s) => s.nodeId === "look")
				.map((s) => s.outputs.log_tail),
		).toEqual(["src/a.ts", "src/b.ts"]);

		for (const glob of ["../*", "/etc/*", "src/../../x", "{..,src}/*"]) {
			const escaping = await engine.startRun({
				projectId: id,
				flow,
				inputs: { pattern: glob },
			});
			const failed = await waitForEnd(engine, escaping.id);
			expect(failed.status).toBe("failed");
			expect(stepOf(failed, "files").error).toContain(
				"points outside the project",
			);
		}
	});

	test("a command source of plain strings, and of objects with `dependsOn` and a parent", async () => {
		await saveFlow(
			"echo",
			flowOf([command("say", `echo "{{item}} {{run.index}}"`)], [], {
				inputs: [{ name: "item", type: "json", required: true }],
			}),
		);
		await saveFlow(
			"issue",
			flowOf(
				[
					command(
						"work",
						`echo "#{{item.number}} of #{{item.parent.number}}"; test "{{item.id}}" != a`,
					),
				],
				[],
				{ inputs: [{ name: "item", type: "json", required: true }] },
			),
		);
		const engine = makeEngine(fakeHarness());
		const id = await projectId(engine);
		const strings = await engine.startRun({
			projectId: id,
			flow: flowOf([
				callEach("loop", "echo", {
					kind: "command",
					command: `printf '%s' '["x","y"]'`,
				}),
			]),
		});
		const plain = await waitForEnd(engine, strings.id);
		expect(plain.status).toBe("finished");
		expect(
			stepOf(plain, "loop").items.map((i) => [i.id, i.title, i.value]),
		).toEqual([
			["0", "x", "x"],
			["1", "y", "y"],
		]);
		expect(
			plain.steps
				.filter((s) => s.nodeId === "say")
				.map((s) => s.outputs.log_tail),
		).toEqual(["x 0", "y 1"]);

		const elements = [
			{ id: "b", number: 2, parent: { number: 9 }, dependsOn: ["a"] },
			{ id: "a", number: 1, parent: { number: 9 } },
			{
				id: "c",
				number: 3,
				parent: { number: 9 },
				dependsOn: [{ id: "z", done: true }],
			},
		];
		const objects = await engine.startRun({
			projectId: id,
			flow: flowOf([
				callEach("loop", "issue", {
					kind: "command",
					command: `printf '%s' '${JSON.stringify(elements)}'`,
				}),
			]),
		});
		const detail = await waitForEnd(engine, objects.id);
		expect(detail.status).toBe("finished");
		const loop = stepOf(detail, "loop");
		expect(loop.items.map((i) => [i.id, i.state, i.reason])).toEqual([
			[
				"a",
				"failed",
				'Node "work" ended with "fail" and no edge leaves it on that outcome.',
			],
			["b", "blocked", "blocked by a"],
			["c", "done", null],
		]);
		expect(loop.outputs).toMatchObject({
			done_count: 1,
			failed_count: 1,
			blocked_count: 1,
		});
		expect(
			detail.steps
				.filter((s) => s.nodeId === "work")
				.map((s) => s.outputs.log_tail),
		).toEqual(["#1 of #9", "#3 of #9"]);
	});
});

describe("Agent outcomes and output schemas", () => {
	const review = (extra: Partial<AgentNode> = {}) =>
		agent("review", "Review", {
			outcomes: [
				{ name: "approved", description: "Good to ship" },
				{ name: "changes" },
			],
			...extra,
		});

	test("the agent's own outcomes route edges", async () => {
		const harness = reportingHarness(() => ({ outcome: "changes" }));
		const engine = makeEngine(harness);
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[review(), command("ship", "echo ship"), command("fix", "echo fix")],
				[
					edge("e1", "review", "approved", "ship"),
					edge("e2", "review", "changes", "fix"),
				],
			),
		});
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("finished");
		expect(harness.calls[0]?.stepReport).toEqual({
			outcomes: [
				{ name: "approved", description: "Good to ship" },
				{ name: "changes" },
			],
		});
		expect(stepOf(detail, "review").outcome).toBe("changes");
		expect(detail.steps.map((s) => s.nodeId)).toEqual(["review", "fix"]);
	});

	test("an own outcome without an edge is a chosen end; one named `fail` is not", async () => {
		const engine = makeEngine(
			reportingHarness(() => ({ outcome: "approved" })),
		);
		const id = await projectId(engine);
		const run = await engine.startRun({
			projectId: id,
			flow: flowOf([review()]),
		});
		const detail = await waitForEnd(engine, run.id);
		expect(detail.status).toBe("finished");
		expect(detail.reason).toBe('Ended at node "review" with "approved".');

		const failing = makeEngine(reportingHarness(() => ({ outcome: "fail" })));
		const failRun = await failing.startRun({
			projectId: id,
			flow: flowOf([review({ outcomes: [{ name: "ok" }, { name: "fail" }] })]),
		});
		const failed = await waitForEnd(failing, failRun.id);
		expect(failed.status).toBe("failed");
		expect(failed.reason).toContain('Node "review" ended with "fail"');
	});

	test("an outcome the node does not have, or no report, is an error", async () => {
		const id = await projectId(makeEngine(fakeHarness()));
		const cases: [
			Partial<AgentNode>,
			ReturnType<typeof reportingHarness>,
			string,
		][] = [
			[
				{},
				reportingHarness(() => ({ outcome: "pass" })),
				'The agent reported "pass", which is not an outcome of this node. Its outcomes are: approved, changes.',
			],
			[
				{},
				reportingHarness(() => null),
				"The agent finished with no step report. This node needs one of its outcomes: approved, changes.",
			],
			[
				{ outcomes: undefined },
				reportingHarness(() => ({ outcome: "approved" })),
				'The agent reported "approved", which is not an outcome of this node. Its outcomes are: pass, fail, needs-input.',
			],
		];
		for (const [extra, harness, error] of cases) {
			const engine = makeEngine(harness);
			const run = await engine.startRun({
				projectId: id,
				flow: flowOf([review(extra)]),
			});
			const detail = await waitForEnd(engine, run.id);
			expect(detail.status).toBe("failed");
			expect(stepOf(detail, "review").outcome).toBe("error");
			expect(stepOf(detail, "review").error).toBe(error);
		}
		// Without own outcomes, a session without a report still passes.
		const plain = makeEngine(reportingHarness(() => null));
		const run = await plain.startRun({
			projectId: id,
			flow: flowOf([agent("a", "Hi")]),
		});
		expect((await waitForEnd(plain, run.id)).status).toBe("finished");
	});

	test("the output schema checks the report's data", async () => {
		const output = {
			type: "object",
			required: ["score"],
			properties: { score: { type: "number" } },
		};
		const id = await projectId(makeEngine(fakeHarness()));
		const cases: [unknown, string | null][] = [
			[{ score: 7 }, null],
			[
				{ score: "high" },
				"The agent's data does not match the output schema: data/score must be number.",
			],
			[
				undefined,
				"The agent's step report has no data, but this node has an output schema.",
			],
		];
		for (const [data, error] of cases) {
			const engine = makeEngine(
				reportingHarness(() => (data === undefined ? {} : { data })),
			);
			const run = await engine.startRun({
				projectId: id,
				flow: flowOf(
					[
						agent("rate", "Rate", { output }),
						command("use", `echo "{{rate.data.score}}"`),
					],
					[edge("e1", "rate", "pass", "use")],
				),
			});
			const detail = await waitForEnd(engine, run.id);
			const rate = stepOf(detail, "rate");
			if (error === null) {
				expect(detail.status).toBe("finished");
				expect(rate.outputs.data).toEqual({ score: 7 });
				expect(logOf(detail, "use")).toBe("7");
			} else {
				expect(detail.status).toBe("failed");
				expect(rate.outcome).toBe("error");
				expect(rate.error).toBe(error);
			}
		}
		// No report at all: no data either.
		const silent = makeEngine(reportingHarness(() => null));
		const run = await silent.startRun({
			projectId: id,
			flow: flowOf([agent("rate", "Rate", { output })]),
		});
		const detail = await waitForEnd(silent, run.id);
		expect(stepOf(detail, "rate").error).toBe(
			"The agent finished with no step report, so it gave no data for the output schema.",
		);
	});
});

describe("flow format 1", () => {
	test("a run snapshot of format 1 still loads and resumes", async () => {
		const engine = makeEngine(fakeHarness());
		const projectIdV1 = await projectId(engine);
		const top = {
			version: 1,
			params: [{ name: "epic", required: true }],
			start: "loop",
			nodes: [
				{
					id: "loop",
					type: "foreach",
					position: { x: 0, y: 0 },
					source: {
						kind: "command",
						command: `printf '%s' '[{"id":"12","title":"first"}]'`,
					},
					flow: "build",
					branchPerItem: false,
					haltOn: ["halt"],
				},
				{
					id: "after",
					type: "command",
					position: { x: 0, y: 0 },
					command: 'echo "epic {{params.epic}}: {{loop.summary}}"',
				},
			],
			edges: [{ id: "e1", from: "loop", outcome: "done", to: "after" }],
		};
		const body = {
			version: 1,
			input: "item",
			start: "work",
			nodes: [
				{
					id: "work",
					type: "command",
					position: { x: 0, y: 0 },
					command:
						'echo "{{item.title}} #{{item.number}} of #{{item.parent_number}} on {{item.branch}}"',
				},
			],
			edges: [],
		};
		const runId = "00000000-v1-run";
		const { run, step } = await import("@nightshift/db/schema/nightshift");
		await sandbox.db.insert(run).values({
			id: runId,
			projectId: projectIdV1,
			flowName: "night",
			flow: JSON.stringify(top),
			bodyFlows: JSON.stringify({ build: body }),
			title: "night · epic 7",
			worktreePath: sandbox.repoPath,
			branch: "main",
			baseRef: "main",
			walkerId: sandbox.deviceId,
		});
		const push = (
			type: string,
			payload: unknown,
			stepId: string | null = null,
		) =>
			appendEvent(
				sandbox.db,
				{
					type: type as "RunEnded",
					runId,
					stepId,
					payload: payload as never,
				},
				sandbox.deviceId,
			);
		const stepRow = (id: string, nodeId: string, nodeType: string) =>
			sandbox.db.insert(step).values({
				id,
				runId,
				nodeId,
				nodeType,
				visit: 1,
				transcriptPath: join(sandbox.dataDir, `${id}.ndjson`),
			});
		await push("RunStarted", {
			projectId: projectIdV1,
			flowName: "night",
			title: "night · epic 7",
			start: "loop",
			params: { epic: "7" },
		});
		await stepRow("loop-1", "loop", "foreach");
		await push(
			"StepStarted",
			{
				nodeId: "loop",
				nodeType: "foreach",
				visit: 1,
				transcriptPath: join(sandbox.dataDir, "loop-1.ndjson"),
				logPath: null,
			},
			"loop-1",
		);
		await push("ItemsRead", { count: 1, open: 1 }, "loop-1");
		await push(
			"ItemStarted",
			{
				item: {
					id: "12",
					number: 12,
					title: "first",
					body: "the body",
					url: null,
					parentNumber: 7,
					parentTitle: "The Epic",
				},
				index: 1,
				branch: null,
				baseBranch: null,
			},
			"loop-1",
		);
		await stepRow("work-1", "work", "command");
		await push(
			"StepStarted",
			{
				nodeId: "work",
				nodeType: "command",
				visit: 1,
				transcriptPath: join(sandbox.dataDir, "work-1.ndjson"),
				logPath: null,
				scope: { forEachStepId: "loop-1", itemId: "12" },
			},
			"work-1",
		);
		await push(
			"StepEnded",
			{
				outcome: "stopped",
				outputs: { outcome: "stopped", visit: 1 },
				error: null,
			},
			"work-1",
		);
		await push(
			"StepEnded",
			{
				outcome: "stopped",
				outputs: { outcome: "stopped", visit: 1 },
				error: null,
			},
			"loop-1",
		);
		await push("RunEnded", { status: "stopped", reason: null });

		const listed = await engine.listRuns();
		expect(listed.find((r) => r.id === runId)).toMatchObject({
			status: "stopped",
			inputs: { epic: "7" },
		});
		const loaded = await engine.getRun(runId);
		expect(loaded.flow.version).toBe(4);
		expect(loaded.flow.inputs).toEqual([
			expect.objectContaining({ name: "epic", type: "text", required: true }),
		]);
		expect(loaded.calledFlows.build?.inputs).toEqual([
			expect.objectContaining({ name: "item", type: "json", required: true }),
		]);
		const loop = stepOf(loaded, "loop");
		// A For Each step from before flow version 4 reads as a Call step.
		expect(loop.nodeType).toBe("call");
		expect(loop.items[0]).toMatchObject({
			id: "12",
			title: "first",
			value: { number: 12, parent: { number: 7, title: "The Epic" } },
		});
		expect(stepOf(loaded, "work").scope).toEqual({
			parentStepId: "loop-1",
			itemId: "12",
		});

		await engine.resumeRun(runId);
		const detail = await waitForEnd(engine, runId);
		expect(detail.status).toBe("finished");
		expect(logOf(detail, "work")).toBe("first #12 of #7 on main");
		expect(logOf(detail, "after")).toBe("epic 7: #12 done");
		expect(stepOf(detail, "loop").items).toHaveLength(1);
	});

	test("the rpgdotexe flows of format 1 start and walk to the first agent", async () => {
		const fixtures = join(import.meta.dir, "fixtures", "rpgdotexe-v1");
		const flowsDir = join(sandbox.repoPath, ".nightshift", "flows");
		await mkdir(flowsDir, { recursive: true });
		for (const name of ["night", "feature", "trace"]) {
			await copyFile(
				join(fixtures, `${name}.json`),
				join(flowsDir, `${name}.json`),
			);
		}
		// What the night's commands need: an ignored `.build/`, the script, and `gh`.
		await writeFile(join(sandbox.repoPath, ".gitignore"), ".build/\n");
		await mkdir(join(sandbox.repoPath, "tools", "night-shift"), {
			recursive: true,
		});
		await writeFile(
			join(sandbox.repoPath, "tools", "night-shift", "night-shift.py"),
			"def claimed_scenarios(text):\n    return ['Scenario one']\n",
		);
		await mustGit(sandbox.repoPath, ["add", ".gitignore", "tools"]);
		await mustGit(sandbox.repoPath, [
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@nightshift.invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-q",
			"-m",
			"night tools",
		]);
		const bin = join(sandbox.root, "bin");
		await mkdir(bin, { recursive: true });
		// The migrated For Each sources ask `gh api graphql` for the sub-issues
		// of their parent: the fake answers with the items, per parent number,
		// and logs each parent it was asked for.
		const reads = join(sandbox.root, "gh-reads.txt");
		const issue = (
			number: number,
			title: string,
			parent: { number: number; title: string },
		) => ({
			id: String(number),
			number,
			title,
			body: `Body of #${number}`,
			url: `https://github.test/issues/${number}`,
			state: "OPEN",
			labels: [],
			parent,
			dependsOn: [],
			done: false,
		});
		const answers: Record<string, unknown[]> = {
			"1097": [issue(5, "A Feature", { number: 1097, title: "The Epic" })],
			"5": [issue(7, "A Trace", { number: 5, title: "A Feature" })],
		};
		await writeFile(
			join(bin, "gh"),
			[
				"#!/bin/sh",
				'if [ "$1" = api ] && [ "$2" = graphql ]; then',
				`  for arg in "$@"; do case "$arg" in number=*) parent="\${arg#number=}" ;; esac; done`,
				`  echo "$parent" >> '${reads}'`,
				'  case "$parent" in',
				...Object.entries(answers).map(
					([parent, items]) =>
						`    ${parent}) printf '%s' '${JSON.stringify(items)}' ;;`,
				),
				"    *) echo '[]' ;;",
				"  esac",
				"  exit 0",
				"fi",
				"echo 'A body from gh'",
				"",
			].join("\n"),
		);
		await chmod(join(bin, "gh"), 0o755);
		const path = process.env.PATH;
		process.env.PATH = `${bin}:${path}`;
		try {
			const { harness, sessions } = scriptedHarness();
			const engine = makeEngine(harness, { decider: fakeDecider([]) });
			const id = await projectId(engine);
			const run = await engine.startRun({
				projectId: id,
				flowName: "night",
				inputs: { epic: "1097" },
			});
			expect(run.title).toBe("night · epic 1097");
			const session = await waitFor(() => sessions[0], {
				label: "the worker's session",
				timeoutMs: 15_000,
			});
			expect((await Bun.file(reads).text()).trim().split("\n")).toEqual([
				"1097",
				"5",
			]);
			const prompt = session.input.prompt;
			expect(prompt).toContain("Trace #7: A Trace");
			expect(prompt).toContain("Feature #5: A Feature");
			expect(prompt).toContain(
				`Branch: \`nightshift/${run.id.slice(0, 8)}-7-a-trace\``,
			);
			expect(prompt).toContain("Body of #7");
			const detail = await engine.getRun(run.id);
			expect(Object.keys(detail.calledFlows).sort()).toEqual([
				"feature",
				"trace",
			]);
			expect(detail.steps.map((s) => [s.nodeId, s.outcome])).toEqual([
				["features", null],
				["begin", "pass"],
				["traces", null],
				["prepare", "pass"],
				["worker", null],
			]);
			await engine.stopRun(run.id);
			expect((await engine.getRun(run.id)).status).toBe("stopped");
		} finally {
			process.env.PATH = path;
		}
	});
});
