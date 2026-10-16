import { describe, expect, test } from "bun:test";
import type {
	AgentNode,
	CommandNode,
	DecisionNode,
	Flow,
	FlowEdge,
	FlowNode,
	ForEachNode,
	GateNode,
	SubflowNode,
} from "./schema";
import type { FlowIssue } from "./types";
import { parseFlow, validateFlow } from "./validate";

function agent(id: string, extra: Partial<AgentNode> = {}): AgentNode {
	return {
		id,
		type: "agent",
		position: { x: 0, y: 0 },
		prompt: "Do the work",
		harness: "claude-code",
		model: "sonnet",
		permissionMode: "acceptEdits",
		session: "fresh",
		...extra,
	};
}

function command(id: string, extra: Partial<CommandNode> = {}): CommandNode {
	return {
		id,
		type: "command",
		position: { x: 0, y: 0 },
		command: "bun test",
		...extra,
	};
}

function decision(
	id: string,
	labels: string[],
	extra: Partial<DecisionNode> = {},
): DecisionNode {
	return {
		id,
		type: "decision",
		position: { x: 0, y: 0 },
		prompt: "Should we go on?",
		labels: labels.map((name) => ({ name })),
		decider: "claude-code",
		model: "haiku",
		...extra,
	};
}

function gate(
	id: string,
	choices: string[],
	extra: Partial<GateNode> = {},
): GateNode {
	return {
		id,
		type: "gate",
		position: { x: 0, y: 0 },
		question: "Ship it?",
		choices: choices.map((name) => ({ name })),
		...extra,
	};
}

function foreach(
	id: string,
	body: string,
	extra: Partial<ForEachNode> = {},
): ForEachNode {
	return {
		id,
		type: "foreach",
		position: { x: 0, y: 0 },
		source: { kind: "github", parent: "12", doneLabels: [], skipLabels: [] },
		flow: body,
		as: "item",
		inputs: {},
		branch: "per-item",
		haltOn: ["halt"],
		...extra,
	};
}

function subflow(
	id: string,
	called: string,
	extra: Partial<SubflowNode> = {},
): SubflowNode {
	return {
		id,
		type: "subflow",
		position: { x: 0, y: 0 },
		flow: called,
		inputs: {},
		...extra,
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

function flow(nodes: FlowNode[], edges: FlowEdge[], start = "worker"): Flow {
	return { version: 2, inputs: [], outputs: [], start, nodes, edges };
}

const errors = (issues: FlowIssue[]) =>
	issues.filter((issue) => issue.severity === "error");
const warnings = (issues: FlowIssue[]) =>
	issues.filter((issue) => issue.severity === "warning");

/** worker → check → worker on fail: the Slice 2 retry loop. */
function retryLoop(max: number | undefined): Flow {
	return flow(
		[
			agent("worker", {
				prompt: "Fix the tests. Last run:\n{{ check.log_tail }}",
			}),
			command("check"),
		],
		[
			edge("work-done", "worker", "pass", "check"),
			edge("retry", "check", "fail", "worker", max),
		],
	);
}

describe("validateFlow", () => {
	test("a worker → check → worker retry loop with max 3 is valid", () => {
		expect(validateFlow(retryLoop(3))).toEqual([]);
	});

	test("the same loop without a max is an error naming the cycle", () => {
		const issues = validateFlow(retryLoop(undefined));
		expect(issues).toEqual([
			{
				severity: "error",
				message: expect.stringContaining("worker → check → worker"),
				nodeId: "worker",
			},
		]);
	});

	test("a self-loop without a max is an error", () => {
		const issues = validateFlow(
			flow([agent("worker")], [edge("again", "worker", "fail", "worker")]),
		);
		expect(errors(issues)).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("worker → worker"),
				nodeId: "worker",
			}),
		]);
	});

	test("a self-loop with a max is fine", () => {
		expect(
			validateFlow(
				flow([agent("worker")], [edge("again", "worker", "fail", "worker", 2)]),
			),
		).toEqual([]);
	});

	test("reports each unbounded cycle once", () => {
		const issues = validateFlow(
			flow(
				[agent("worker"), command("check"), agent("fixer"), command("lint")],
				[
					edge("a", "worker", "pass", "check"),
					edge("b", "check", "fail", "worker"),
					edge("c", "check", "pass", "fixer"),
					edge("d", "fixer", "pass", "lint"),
					edge("e", "lint", "fail", "fixer"),
				],
			),
		);
		const cycles = errors(issues).map((issue) => issue.message);
		expect(cycles).toHaveLength(2);
		expect(cycles[0]).toContain("worker → check → worker");
		expect(cycles[1]).toContain("fixer → lint → fixer");
	});

	test("a cycle is fine when any one of its edges has a max", () => {
		const issues = validateFlow(
			flow(
				[agent("worker"), command("check"), agent("review")],
				[
					edge("a", "worker", "pass", "check"),
					edge("b", "check", "pass", "review"),
					edge("c", "review", "fail", "worker", 2),
				],
			),
		);
		expect(issues).toEqual([]);
	});

	test("a bounded edge does not hide an unbounded parallel path", () => {
		const issues = validateFlow(
			flow(
				[agent("worker"), command("check")],
				[
					edge("a", "worker", "pass", "check"),
					edge("retry", "check", "fail", "worker", 3),
					edge("loop", "worker", "fail", "check"),
					edge("back", "check", "pass", "worker"),
				],
			),
		);
		expect(errors(issues)).toHaveLength(1);
		expect(errors(issues)[0]?.message).toContain("worker → check → worker");
	});

	test("duplicate node and edge ids", () => {
		const issues = validateFlow(
			flow(
				[agent("worker"), command("check"), command("check")],
				[
					edge("a", "worker", "pass", "check"),
					edge("a", "check", "fail", "worker", 1),
				],
			),
		);
		expect(errors(issues)).toEqual([
			expect.objectContaining({ nodeId: "check" }),
			expect.objectContaining({ edgeId: "a" }),
		]);
	});

	test("unknown start node", () => {
		const issues = validateFlow(flow([agent("worker")], [], "begin"));
		expect(issues).toEqual([
			expect.objectContaining({ severity: "error", nodeId: "begin" }),
		]);
	});

	test("edges from and to unknown nodes", () => {
		const issues = validateFlow(
			flow(
				[agent("worker")],
				[
					edge("out", "worker", "pass", "ghost"),
					edge("in", "phantom", "pass", "worker"),
				],
			),
		);
		expect(errors(issues)).toEqual([
			expect.objectContaining({
				edgeId: "out",
				message: expect.stringContaining('"ghost"'),
			}),
			expect.objectContaining({
				edgeId: "in",
				message: expect.stringContaining('"phantom"'),
			}),
		]);
	});

	test("an outcome the source node type cannot produce", () => {
		const issues = validateFlow(
			flow(
				[agent("worker"), command("check")],
				[
					edge("a", "worker", "needs-input", "check"),
					edge("b", "check", "needs-input", "worker", 1),
				],
			),
		);
		expect(errors(issues)).toEqual([
			expect.objectContaining({
				edgeId: "b",
				message: expect.stringContaining("needs-input"),
			}),
		]);
	});

	test("an agent node needs a prompt or a skill", () => {
		expect(
			errors(validateFlow(flow([agent("worker", { prompt: "  " })], []))),
		).toEqual([expect.objectContaining({ nodeId: "worker" })]);
		expect(
			validateFlow(
				flow([agent("worker", { prompt: "", skill: "review" })], []),
			),
		).toEqual([]);
	});

	test("template references to unknown nodes and fields", () => {
		const issues = validateFlow(
			flow(
				[
					agent("worker", {
						prompt:
							"{{ghost.output}} {{check.output}} {{run.nope}} {{run.branch}} {{check.log_tail}} {{worker.summary}}",
					}),
					command("check", {
						command: "echo {{worker.exit_code}} {{worker.output}}",
					}),
				],
				[edge("a", "worker", "pass", "check")],
			),
		);
		const messages = errors(issues).map((issue) => [
			issue.nodeId,
			issue.message,
		]);
		expect(messages).toEqual([
			["worker", expect.stringContaining("{{ghost.output}}")],
			["worker", expect.stringContaining("{{check.output}}")],
			["worker", expect.stringContaining("{{run.nope}}")],
			["check", expect.stringContaining("{{worker.exit_code}}")],
		]);
		expect(warnings(issues)).toEqual([]);
	});

	test("a template may reference the node itself", () => {
		expect(
			validateFlow(
				flow(
					[agent("worker", { prompt: "Last time: {{worker.output}}" })],
					[edge("again", "worker", "fail", "worker", 2)],
				),
			),
		).toEqual([]);
	});

	test("the node id run is reserved", () => {
		const issues = validateFlow(flow([agent("run")], [], "run"));
		expect(errors(issues)).toEqual([
			expect.objectContaining({ nodeId: "run" }),
		]);
	});

	test("warns about nodes unreachable from start", () => {
		const issues = validateFlow(
			flow(
				[agent("worker"), command("check"), command("orphan"), agent("island")],
				[
					edge("a", "worker", "pass", "check"),
					edge("b", "orphan", "pass", "island"),
				],
			),
		);
		expect(issues).toEqual([
			expect.objectContaining({ severity: "warning", nodeId: "orphan" }),
			expect.objectContaining({ severity: "warning", nodeId: "island" }),
		]);
	});

	test("reachability follows edges with a max", () => {
		expect(validateFlow(retryLoop(3))).toEqual([]);
		const issues = validateFlow(
			flow(
				[agent("worker"), command("check")],
				[edge("a", "worker", "pass", "check", 1)],
			),
		);
		expect(issues).toEqual([]);
	});

	test("warns about an edge after an unbounded edge on the same outcome", () => {
		const issues = validateFlow(
			flow(
				[agent("worker"), command("check"), agent("other")],
				[
					edge("first", "worker", "pass", "check"),
					edge("never", "worker", "pass", "other"),
					edge("other-outcome", "worker", "fail", "other"),
				],
			),
		);
		expect(issues).toEqual([
			expect.objectContaining({ severity: "warning", edgeId: "never" }),
		]);
	});

	test("an edge after a bounded edge on the same outcome is fine", () => {
		const issues = validateFlow(
			flow(
				[agent("worker"), command("check"), agent("other")],
				[
					edge("first", "worker", "pass", "check", 2),
					edge("fallback", "worker", "pass", "other"),
				],
			),
		);
		expect(issues).toEqual([]);
	});
});

/** worker → decide → gate → ship, with retry loops back to the worker. */
function decideAndGate(): Flow {
	return flow(
		[
			agent("worker", {
				prompt: "Build it. Reviewer said: {{gate.note}}",
				clis: ["gh"],
			}),
			decision("decide", ["continue", "stop"], {
				prompt: "The worker reported: {{worker.summary}}. Go on?",
			}),
			gate("gate", ["approve", "reject"], {
				question: "The decider said {{decide.outcome}}: {{decide.notes}}",
			}),
			command("ship", { command: "gh pr ready" }),
			agent("wrap_up", { prompt: "Write down why we stopped." }),
		],
		[
			edge("built", "worker", "pass", "decide"),
			edge("go-on", "decide", "continue", "gate"),
			edge("halt", "decide", "stop", "wrap_up"),
			edge("approved", "gate", "approve", "ship"),
			edge("rejected", "gate", "reject", "worker", 3),
		],
	);
}

describe("validateFlow: decisions and gates", () => {
	test("worker → decide → gate → ship validates", () => {
		expect(validateFlow(decideAndGate())).toEqual([]);
		const json = JSON.parse(JSON.stringify(decideAndGate()));
		delete json.nodes[1].decider;
		delete json.nodes[1].model;
		const parsed = parseFlow(json);
		expect(parsed.issues).toEqual([]);
		expect(parsed.flow?.nodes[1]).toMatchObject({
			decider: "claude-code",
			model: "haiku",
		});
	});

	test("an edge outcome must be a label or choice of its source", () => {
		const issues = validateFlow(
			flow(
				[
					agent("worker"),
					decision("decide", ["continue", "stop"]),
					gate("gate", ["approve"]),
				],
				[
					edge("a", "worker", "pass", "decide"),
					edge("b", "decide", "continue", "gate"),
					edge("c", "decide", "stop", "worker", 1),
					edge("d", "decide", "pass", "worker", 1),
					edge("e", "gate", "approve", "worker", 1),
					edge("f", "gate", "continue", "worker", 1),
				],
			),
		);
		expect(errors(issues)).toEqual([
			expect.objectContaining({
				edgeId: "d",
				message: expect.stringContaining("continue, stop"),
			}),
			expect.objectContaining({
				edgeId: "f",
				message: expect.stringContaining('"gate" ends with approve'),
			}),
		]);
	});

	test("a label used by another node is not an outcome of this one", () => {
		const issues = validateFlow(
			flow(
				[agent("worker"), command("check")],
				[
					edge("a", "worker", "approve", "check"),
					edge("b", "check", "continue", "worker", 1),
				],
			),
		);
		expect(errors(issues).map((issue) => issue.edgeId)).toEqual(["a", "b"]);
	});

	test("duplicate decision labels and gate choices", () => {
		const issues = validateFlow(
			flow(
				[
					decision("decide", ["go", "stop", "go"]),
					gate("gate", ["yes", "yes"]),
				],
				[
					edge("a", "decide", "go", "gate"),
					edge("b", "decide", "stop", "gate"),
					edge("c", "gate", "yes", "decide", 1),
				],
				"decide",
			),
		);
		expect(issues).toEqual([
			{
				severity: "error",
				message: expect.stringContaining('label "go" more than once'),
				nodeId: "decide",
			},
			{
				severity: "error",
				message: expect.stringContaining('choice "yes" more than once'),
				nodeId: "gate",
			},
		]);
	});

	test("reserved outcomes cannot be labels or choices", () => {
		const issues = validateFlow(
			flow(
				[
					decision("decide", ["go", "error"]),
					gate("gate", ["waiting", "stopped", "ok"]),
				],
				[
					edge("a", "decide", "go", "gate"),
					edge("b", "gate", "ok", "decide", 1),
				],
				"decide",
			),
		);
		expect(errors(issues)).toEqual([
			expect.objectContaining({
				nodeId: "decide",
				message: expect.stringContaining('"error", which is reserved'),
			}),
			expect.objectContaining({
				nodeId: "gate",
				message: expect.stringContaining('"waiting", which is reserved'),
			}),
			expect.objectContaining({
				nodeId: "gate",
				message: expect.stringContaining('"stopped", which is reserved'),
			}),
		]);
		expect(warnings(issues)).toEqual([]);
	});

	test("a label or choice without an edge is a warning", () => {
		const issues = validateFlow(
			flow(
				[
					agent("worker"),
					decision("decide", ["continue", "stop"]),
					gate("gate", ["approve", "reject"]),
				],
				[
					edge("a", "worker", "pass", "decide"),
					edge("b", "decide", "continue", "gate"),
					edge("c", "gate", "approve", "worker", 2),
				],
			),
		);
		expect(issues).toEqual([
			{
				severity: "warning",
				message:
					'Decision node "decide" has no edge for "stop": the run ends there when the decider picks "stop".',
				nodeId: "decide",
			},
			{
				severity: "warning",
				message:
					'Gate node "gate" has no edge for "reject": the run ends there when the person picks "reject".',
				nodeId: "gate",
			},
		]);
	});

	test("template references in a decision prompt and a gate question", () => {
		const issues = validateFlow(
			flow(
				[
					agent("worker"),
					decision("decide", ["go", "stop"], {
						prompt: "{{worker.summary}} {{worker.log_tail}} {{ghost.notes}}",
					}),
					gate("gate", ["ok"], {
						question:
							"{{decide.notes}} {{decide.summary}} {{run.branch}} {{gate.note}} {{gate.notes}}",
					}),
				],
				[
					edge("a", "worker", "pass", "decide"),
					edge("b", "decide", "go", "gate"),
					edge("c", "decide", "stop", "gate"),
					edge("d", "gate", "ok", "worker", 1),
				],
			),
		);
		expect(
			errors(issues).map((issue) => [issue.nodeId, issue.message]),
		).toEqual([
			[
				"decide",
				expect.stringContaining(
					'The prompt of "decide" uses {{worker.log_tail}}',
				),
			],
			["decide", expect.stringContaining("{{ghost.notes}}")],
			[
				"gate",
				expect.stringContaining(
					'The question of "gate" uses {{decide.summary}}',
				),
			],
			["gate", expect.stringContaining("{{gate.notes}}")],
		]);
	});

	test("an agent may read decision and gate fields", () => {
		const issues = validateFlow(
			flow(
				[
					decision("decide", ["go", "stop"]),
					gate("gate", ["ok"]),
					agent("worker", {
						prompt:
							"{{decide.outcome}} {{decide.notes}} {{decide.visit}} {{gate.outcome}} {{gate.note}} {{gate.visit}}",
					}),
				],
				[
					edge("a", "decide", "go", "gate"),
					edge("b", "decide", "stop", "worker"),
					edge("c", "gate", "ok", "worker"),
				],
				"decide",
			),
		);
		expect(issues).toEqual([]);
	});

	test("a loop through a gate still needs a max", () => {
		const looping = flow(
			[agent("worker"), gate("gate", ["approve", "reject"])],
			[
				edge("a", "worker", "pass", "gate"),
				edge("b", "gate", "reject", "worker"),
				edge("c", "gate", "approve", "worker", 1),
			],
		);
		expect(validateFlow(looping)).toEqual([
			{
				severity: "error",
				message: expect.stringContaining("worker → gate → worker"),
				nodeId: "worker",
			},
		]);
		const gateOnly = flow(
			[gate("gate", ["again", "done"])],
			[edge("a", "gate", "again", "gate")],
			"gate",
		);
		expect(errors(validateFlow(gateOnly))).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("gate → gate"),
			}),
		]);
	});

	test("a loop through a decision still needs a max", () => {
		const issues = validateFlow(
			flow(
				[agent("worker"), decision("decide", ["again", "done"])],
				[
					edge("a", "worker", "pass", "decide"),
					edge("b", "decide", "again", "worker"),
					edge("c", "decide", "done", "worker", 1),
				],
			),
		);
		expect(errors(issues)).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("worker → decide → worker"),
			}),
		]);
	});
});

describe("parseFlow", () => {
	test("parses a valid flow and applies defaults", () => {
		const json = JSON.parse(JSON.stringify(retryLoop(3)));
		delete json.nodes[0].session;
		const result = parseFlow(json);
		expect(result.issues).toEqual([]);
		expect(result.flow?.nodes[0]).toMatchObject({ session: "fresh" });
	});

	test("returns validation issues with the flow", () => {
		const result = parseFlow(retryLoop(undefined));
		expect(result.flow).not.toBeNull();
		expect(errors(result.issues)).toHaveLength(1);
	});

	test("turns schema errors into one issue per zod issue, with the path", () => {
		const result = parseFlow({
			version: 2,
			start: "Worker",
			nodes: [{ ...agent("worker"), model: "" }],
			edges: [{ id: "a", from: "worker", outcome: "Maybe", to: "check" }],
		});
		expect(result.flow).toBeNull();
		expect(result.issues.map((issue) => issue.severity)).toEqual([
			"error",
			"error",
			"error",
		]);
		const messages = result.issues.map((issue) => issue.message);
		expect(messages.some((m) => m.startsWith("start: "))).toBe(true);
		expect(messages.some((m) => m.startsWith("nodes.0.model: "))).toBe(true);
		expect(messages.some((m) => m.startsWith("edges.0.outcome: "))).toBe(true);
	});

	test("a value that is not an object is a root issue", () => {
		const result = parseFlow("nope");
		expect(result.flow).toBeNull();
		expect(result.issues).toEqual([
			{ severity: "error", message: expect.stringMatching(/^\(root\): /) },
		]);
	});
});

/** The flow with these inputs. */
function withInputs(f: Flow, inputs: Flow["inputs"]): Flow {
	return { ...f, inputs };
}

const itemInput: Flow["inputs"][number] = {
	name: "item",
	type: "json",
	required: true,
};

describe("validateFlow: names and inputs", () => {
	test("a flow reads its inputs: text as is, json with any path", () => {
		const f = withInputs(
			flow(
				[
					agent("worker", {
						prompt:
							"Epic {{epic}}: #{{item.number}} under {{item.parent.number}}, labels {{item.labels.0}}, all {{item}}",
					}),
				],
				[],
			),
			[{ name: "epic", type: "text" }, itemInput],
		);
		expect(validateFlow(f)).toEqual([]);
	});

	test("a text input takes no path", () => {
		const f = withInputs(
			flow([agent("worker", { prompt: "{{epic.number}}" })], []),
			[{ name: "epic", type: "text" }],
		);
		expect(errors(validateFlow(f))).toEqual([
			expect.objectContaining({
				nodeId: "worker",
				message: expect.stringContaining('the input "epic" is text'),
			}),
		]);
	});

	test("a name that is neither a node nor an input is an error", () => {
		const f = flow(
			[agent("worker", { prompt: "{{epic}} {{item.title}}" })],
			[],
		);
		expect(errors(validateFlow(f)).map((issue) => issue.message)).toEqual([
			'The prompt of "worker" uses {{epic}}, but there is no node or input "epic".',
			'The prompt of "worker" uses {{item.title}}, but there is no node or input "item".',
		]);
	});

	test("an input and a node cannot share a name", () => {
		const f = withInputs(flow([agent("worker")], []), [
			{ name: "worker", type: "text" },
		]);
		expect(errors(validateFlow(f))).toEqual([
			expect.objectContaining({
				nodeId: "worker",
				message: expect.stringContaining("Rename one of them"),
			}),
		]);
	});

	test("input names are unique", () => {
		const f = withInputs(flow([agent("worker")], []), [
			{ name: "epic", type: "text" },
			{ name: "epic", type: "json" },
		]);
		expect(errors(validateFlow(f)).map((issue) => issue.message)).toEqual([
			'The input "epic" is declared more than once.',
		]);
	});

	test("run is reserved for inputs and node ids", () => {
		const f = withInputs(flow([agent("worker")], []), [
			{ name: "run", type: "text" },
		]);
		expect(errors(validateFlow(f)).map((issue) => issue.message)).toEqual([
			'The input name "run" is reserved. Pick another name.',
		]);
	});

	test("item and params are ordinary names now", () => {
		expect(
			validateFlow(
				flow(
					[agent("item"), agent("params")],
					[edge("a", "item", "pass", "params")],
					"item",
				),
			),
		).toEqual([]);
	});

	test("the default of a json input must be JSON", () => {
		const f = withInputs(flow([agent("worker")], []), [
			{ name: "good", type: "json", default: '[{"id": 1}]' },
			{ name: "bad", type: "json", default: "{nope" },
			{ name: "text", type: "text", default: "{nope" },
		]);
		expect(errors(validateFlow(f)).map((issue) => issue.message)).toEqual([
			'The default of the json input "bad" is not valid JSON.',
		]);
	});
});

describe("validateFlow: template paths", () => {
	const f = (prompt: string): Flow =>
		flow(
			[
				agent("planner"),
				foreach("each", "trace"),
				command("check"),
				agent("worker", { prompt }),
			],
			[
				edge("a", "planner", "pass", "each"),
				edge("b", "each", "done", "check"),
				edge("c", "check", "pass", "worker"),
			],
			"planner",
		);

	test("paths below data and results are fine", () => {
		expect(
			validateFlow(
				f(
					"{{planner.data}} {{planner.data.tasks.0.title}} {{each.results.0.outputs.pr}}",
				),
			),
		).toEqual([]);
	});

	test("other node fields take no path", () => {
		expect(
			errors(validateFlow(f("{{check.log_tail.0}} {{planner.summary.x}}"))).map(
				(issue) => issue.message,
			),
		).toEqual([
			'The prompt of "worker" uses {{check.log_tail.0}}, but check.log_tail is text: it takes no path.',
			'The prompt of "worker" uses {{planner.summary.x}}, but planner.summary is text: it takes no path.',
		]);
	});

	test("a node needs a field", () => {
		expect(errors(validateFlow(f("{{check}}")))).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("a node needs a field"),
			}),
		]);
	});

	test("run fields take no path, and run needs a field", () => {
		expect(validateFlow(f("{{run.index}} {{run.base_branch}}"))).toEqual([]);
		expect(
			errors(validateFlow(f("{{run}} {{run.branch.x}} {{run.item}}"))).map(
				(issue) => issue.message,
			),
		).toEqual([
			expect.stringContaining("{{run}}, but the run has no field there"),
			'The prompt of "worker" uses {{run.branch.x}}, but run.branch is text: it takes no path.',
			expect.stringContaining('{{run.item}}, but the run has no field "item"'),
		]);
	});
});

describe("validateFlow: agent outcomes and output", () => {
	const review = (extra: Partial<AgentNode> = {}) =>
		agent("review", {
			outcomes: [{ name: "approved" }, { name: "changes-requested" }],
			...extra,
		});

	test("edges leave on the agent's own outcomes", () => {
		const f = flow(
			[review(), agent("worker")],
			[
				edge("a", "review", "approved", "worker"),
				edge("b", "review", "changes-requested", "worker"),
			],
			"review",
		);
		expect(validateFlow(f)).toEqual([]);
	});

	test("pass, fail and needs-input are gone when outcomes are set", () => {
		const f = flow(
			[review(), agent("worker")],
			[
				edge("a", "review", "approved", "worker"),
				edge("b", "review", "changes-requested", "worker"),
				edge("c", "review", "pass", "worker"),
			],
			"review",
		);
		expect(errors(validateFlow(f))).toEqual([
			expect.objectContaining({
				edgeId: "c",
				message: expect.stringContaining(
					'"review" ends with approved, changes-requested',
				),
			}),
		]);
	});

	test("an outcome without an edge is a warning", () => {
		const f = flow(
			[review(), agent("worker")],
			[edge("a", "review", "approved", "worker")],
			"review",
		);
		expect(validateFlow(f)).toEqual([
			{
				severity: "warning",
				message:
					'Agent node "review" has no edge for "changes-requested": the run ends there when the agent reports "changes-requested".',
				nodeId: "review",
			},
		]);
	});

	test("an own fail or needs-input without an edge is no warning", () => {
		const f = flow(
			[
				review({
					outcomes: [
						{ name: "approved" },
						{ name: "fail" },
						{ name: "needs-input" },
					],
				}),
				agent("worker"),
			],
			[edge("a", "review", "approved", "worker")],
			"review",
		);
		expect(validateFlow(f)).toEqual([]);
	});

	test("the default outcomes need no edges", () => {
		expect(validateFlow(flow([agent("worker")], []))).toEqual([]);
	});

	test("outcomes are unique, valid and not reserved", () => {
		const f = flow(
			[
				review({
					outcomes: [
						{ name: "ok" },
						{ name: "ok" },
						{ name: "error" },
						{ name: "Not OK" },
					],
				}),
			],
			[edge("a", "review", "ok", "review", 1)],
			"review",
		);
		expect(errors(validateFlow(f)).map((issue) => issue.message)).toEqual([
			'Agent node "review" has the outcome "ok" more than once.',
			expect.stringContaining('the outcome "error", which is reserved'),
			expect.stringContaining('"Not OK", which is not a valid label'),
		]);
	});

	test("the output schema must describe an object", () => {
		const ok = [
			{ type: "object", properties: { tasks: { type: "array" } } },
			{ properties: { verdict: { type: "string" } } },
			{ type: "object" },
		];
		for (const output of ok) {
			expect(validateFlow(flow([agent("worker", { output })], []))).toEqual([]);
		}
		for (const output of [{ type: "array" }, {}, { properties: "x" }]) {
			expect(
				errors(validateFlow(flow([agent("worker", { output })], []))),
			).toEqual([
				expect.objectContaining({
					nodeId: "worker",
					message: expect.stringContaining("must describe an object"),
				}),
			]);
		}
	});
});

describe("validateFlow: outputs", () => {
	const f = (outputs: Flow["outputs"]): Flow =>
		withInputs(
			{
				...flow([agent("worker", { output: { type: "object" } })], []),
				outputs,
			},
			[{ name: "epic", type: "text" }],
		);

	test("outputs read nodes, inputs and run", () => {
		expect(
			validateFlow(
				f([
					{ name: "report", value: "{{worker.data}}" },
					{ name: "tasks", value: "{{worker.data.tasks}}" },
					{ name: "line", value: "Epic {{epic}} on {{run.branch}}" },
				]),
			),
		).toEqual([]);
	});

	test("an output template is checked like any template", () => {
		expect(
			validateFlow(f([{ name: "report", value: "{{ghost.data}} {{epic.x}}" }])),
		).toEqual([
			{
				severity: "error",
				message:
					'The value of output "report" uses {{ghost.data}}, but there is no node or input "ghost".',
			},
			{
				severity: "error",
				message: expect.stringContaining('the input "epic" is text'),
			},
		]);
	});

	test("output names are unique, valid, and not a Subflow field", () => {
		expect(
			errors(
				validateFlow(
					f([
						{ name: "report", value: "" },
						{ name: "report", value: "" },
						{ name: "Bad", value: "" },
						{ name: "ended", value: "" },
					]),
				),
			).map((issue) => issue.message),
		).toEqual([
			'The output "report" is declared more than once.',
			expect.stringContaining('The output "Bad" is not a valid name'),
			'The output "ended" clashes with a field every Subflow node has: outcome, ended, visit.',
		]);
	});
});

describe("validateFlow: For Each", () => {
	/** A flow that builds one element. */
	const traceBody = (): Flow =>
		withInputs(
			flow([agent("worker", { prompt: "Build {{item.title}}" })], []),
			[itemInput],
		);

	/** A flow that takes an element, as the called flow of For Each nodes. */
	const body = (f: Flow): Flow => withInputs(f, [itemInput]);

	/** each → report on done: the night. */
	const night = (node: ForEachNode = foreach("each", "trace")): Flow =>
		flow(
			[node, agent("report", { prompt: "{{each.summary}}" })],
			[edge("after", node.id, "done", "report")],
			node.id,
		);

	test("a For Each over a flow with an item input is valid", () => {
		expect(validateFlow(night(), { flows: { trace: traceBody() } })).toEqual(
			[],
		);
	});

	test("edges leave only on done or halted", () => {
		const bad = night();
		bad.edges.push(edge("oops", "each", "pass", "report"));
		bad.edges.push(edge("stop", "each", "halted", "report"));
		expect(errors(validateFlow(bad))).toEqual([
			expect.objectContaining({
				edgeId: "oops",
				message: expect.stringContaining("done, halted"),
			}),
		]);
	});

	test("a node may read the For Each fields", () => {
		const bad = night();
		bad.nodes[1] = agent("report", { prompt: "{{each.output}}" });
		expect(errors(validateFlow(bad))).toEqual([
			expect.objectContaining({
				nodeId: "report",
				message: expect.stringContaining("done_count"),
			}),
		]);
	});

	test("the source templates are checked", () => {
		const github = night(
			foreach("each", "trace", {
				source: {
					kind: "github",
					parent: "{{nope.number}}",
					doneLabels: [],
					skipLabels: [],
				},
			}),
		);
		expect(errors(validateFlow(github))).toEqual([
			expect.objectContaining({
				nodeId: "each",
				message: expect.stringContaining("source parent"),
			}),
		]);
		const command = night(
			foreach("each", "trace", {
				source: { kind: "command", command: "list {{item.number}}" },
			}),
		);
		expect(errors(validateFlow(command))).toEqual([
			expect.objectContaining({
				nodeId: "each",
				message: expect.stringContaining(
					'The source command of "each" uses {{item.number}}',
				),
			}),
		]);
		const json = night(
			foreach("each", "trace", {
				source: { kind: "json", value: "{{plan.data.tasks}}" },
			}),
		);
		expect(errors(validateFlow(json))).toEqual([
			expect.objectContaining({
				nodeId: "each",
				message: expect.stringContaining(
					'The source value of "each" uses {{plan.data.tasks}}',
				),
			}),
		]);
	});

	test("a json source reads another node's data", () => {
		const f = flow(
			[
				agent("planner", { output: { type: "object" } }),
				foreach("each", "trace", {
					source: { kind: "json", value: "{{planner.data.tasks}}" },
				}),
			],
			[edge("a", "planner", "pass", "each")],
			"planner",
		);
		expect(validateFlow(f, { flows: { trace: traceBody() } })).toEqual([]);
	});

	test("the files source glob is checked too", () => {
		const f = (glob: string) =>
			withInputs(
				night(foreach("each", "trace", { source: { kind: "files", glob } })),
				[{ name: "dir", type: "text" }],
			);
		expect(validateFlow(f("{{dir}}/**/*.ts"))).toEqual([]);
		expect(errors(validateFlow(f("src/**/{{x}}.ts")))).toEqual([
			expect.objectContaining({
				nodeId: "each",
				message: expect.stringContaining(
					'The source glob of "each" uses {{x}}',
				),
			}),
		]);
	});

	test("a nested For Each may read the outer item", () => {
		const features = body(
			night(
				foreach("each", "trace", {
					source: {
						kind: "github",
						parent: "{{item.number}}",
						doneLabels: [],
						skipLabels: [],
					},
				}),
			),
		);
		expect(validateFlow(features)).toEqual([]);
	});

	test("halt labels must be valid and not reserved", () => {
		const bad = night(
			foreach("each", "trace", { haltOn: ["halt", "error", "Bad Label"] }),
		);
		const issues = errors(validateFlow(bad));
		expect(issues).toEqual([
			expect.objectContaining({
				nodeId: "each",
				message: expect.stringContaining('"error", which is reserved'),
			}),
			expect.objectContaining({
				nodeId: "each",
				message: expect.stringContaining('"Bad Label", which is not a valid'),
			}),
		]);
	});

	test("without flows the called flow is not checked", () => {
		expect(validateFlow(night(foreach("each", "missing")))).toEqual([]);
	});

	test("the called flow must exist", () => {
		expect(errors(validateFlow(night(), { flows: {} }))).toEqual([
			expect.objectContaining({
				nodeId: "each",
				message:
					'For Each node "each" runs flow "trace", which does not exist.',
			}),
		]);
	});

	test("the called flow must parse", () => {
		expect(errors(validateFlow(night(), { flows: { trace: null } }))).toEqual([
			expect.objectContaining({
				nodeId: "each",
				message: expect.stringContaining("is not valid"),
			}),
		]);
	});

	test("the called flow must have the input named by as", () => {
		const plain = flow([agent("worker")], []);
		expect(errors(validateFlow(night(), { flows: { trace: plain } }))).toEqual([
			expect.objectContaining({
				nodeId: "each",
				message: expect.stringContaining('which has no input "item"'),
			}),
		]);
		const task = withInputs(plain, [{ name: "task", type: "json" }]);
		expect(
			validateFlow(night(foreach("each", "trace", { as: "task" })), {
				flows: { trace: task },
			}),
		).toEqual([]);
	});

	test("as a text input is a warning", () => {
		const text = withInputs(flow([agent("worker")], []), [
			{ name: "item", type: "text", required: true },
		]);
		expect(validateFlow(night(), { flows: { trace: text } })).toEqual([
			expect.objectContaining({
				severity: "warning",
				nodeId: "each",
				message: expect.stringContaining('input "item" is text'),
			}),
		]);
	});

	test("bindings: declared inputs only, templates checked, not the as input", () => {
		const called = withInputs(traceBody(), [
			itemInput,
			{ name: "epic", type: "text", required: true },
		]);
		const flows = { trace: called };
		const bound = (inputs: Record<string, string>) =>
			withInputs(night(foreach("each", "trace", { inputs })), [
				{ name: "epic", type: "text" },
			]);
		expect(validateFlow(bound({ epic: "{{epic}}" }), { flows })).toEqual([]);
		expect(
			errors(
				validateFlow(
					bound({ epic: "{{nope}}", other: "x", item: "{{epic}}" }),
					{ flows },
				),
			).map((issue) => issue.message),
		).toEqual([
			'The input "epic" of "each" uses {{nope}}, but there is no node or input "nope".',
			'For Each node "each" binds the input "item", which already takes each item.',
			'For Each node "each" binds the input "other", but flow "trace" has no such input.',
		]);
	});

	test("every required input without a default is bound", () => {
		const called = (input: Flow["inputs"][number]) => ({
			trace: withInputs(traceBody(), [itemInput, input]),
		});
		expect(
			errors(
				validateFlow(night(), {
					flows: called({ name: "epic", type: "text", required: true }),
				}),
			).map((issue) => issue.message),
		).toEqual([
			'For Each node "each" does not bind the required input "epic" of flow "trace".',
		]);
		for (const input of [
			{ name: "epic", type: "text", required: true, default: "1" },
			{ name: "epic", type: "text" },
		] as const) {
			expect(validateFlow(night(), { flows: called(input) })).toEqual([]);
		}
	});

	test("a called flow with errors gives one error, its issues are not repeated", () => {
		const broken = body(
			flow([agent("worker", { prompt: "{{nope.x}} {{ghost}}" })], []),
		);
		broken.nodes.push(agent("idle"));
		expect(validateFlow(night(), { flows: { trace: broken } })).toEqual([
			{
				severity: "error",
				nodeId: "each",
				message: 'Flow "trace" of For Each node "each" has 2 errors.',
			},
		]);
	});

	test("one error is singular", () => {
		const broken = body(flow([agent("worker", { prompt: "{{nope.x}}" })], []));
		expect(
			errors(validateFlow(night(), { flows: { trace: broken } }))[0]?.message,
		).toBe('Flow "trace" of For Each node "each" has 1 error.');
	});

	test("errors of a nested called flow count once, on its caller", () => {
		const feature = body(night());
		const broken = body(flow([agent("worker", { prompt: "{{nope.x}}" })], []));
		const top = night(foreach("each", "feature"));
		const flows = { feature, trace: broken };
		expect(errors(validateFlow(top, { flows }))).toEqual([
			expect.objectContaining({
				message: 'Flow "feature" of For Each node "each" has 1 error.',
			}),
		]);
	});

	test("a flow that runs itself is an error with the chain", () => {
		const self = body(night(foreach("each", "loop")));
		expect(
			errors(validateFlow(self, { flows: { loop: self }, name: "loop" })),
		).toEqual([
			expect.objectContaining({
				nodeId: "each",
				message: expect.stringContaining("runs this flow again: loop → loop."),
			}),
		]);
	});

	test("A → B → A is an error on A with the chain", () => {
		const a = body(night(foreach("each", "b")));
		const b = body(night(foreach("each", "a")));
		const issues = errors(validateFlow(a, { flows: { a, b }, name: "a" }));
		expect(issues).toEqual([
			expect.objectContaining({
				nodeId: "each",
				message: expect.stringContaining("runs this flow again: a → b → a."),
			}),
		]);
	});

	test("the flow being checked replaces its saved version", () => {
		const saved = body(flow([agent("worker")], []));
		const edited = body(night(foreach("each", "a")));
		expect(
			errors(validateFlow(edited, { flows: { a: saved }, name: "a" })),
		).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("a → a"),
			}),
		]);
	});

	test("a cycle below a called flow is reported once, in that flow", () => {
		const b = body(night(foreach("each", "c")));
		const c = body(night(foreach("each", "b")));
		const top = night(foreach("each", "b"));
		expect(
			errors(validateFlow(top, { flows: { b, c, top }, name: "top" })),
		).toEqual([
			expect.objectContaining({
				message: 'Flow "b" of For Each node "each" has 1 error.',
			}),
		]);
		expect(
			errors(validateFlow(b, { flows: { b, c, top }, name: "b" })),
		).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("runs this flow again: b → c → b."),
			}),
		]);
	});

	test("without a name, a called flow that runs itself still shows up", () => {
		const loop = body(night(foreach("each", "loop")));
		const top = night(foreach("each", "loop"));
		expect(errors(validateFlow(top, { flows: { loop } }))).toEqual([
			expect.objectContaining({
				message: 'Flow "loop" of For Each node "each" has 1 error.',
			}),
		]);
	});

	test("two For Each nodes may share a called flow", () => {
		const twice = flow(
			[foreach("first", "trace"), foreach("second", "trace")],
			[edge("next", "first", "done", "second")],
			"first",
		);
		expect(validateFlow(twice, { flows: { trace: traceBody() } })).toEqual([]);
	});
});

describe("validateFlow: Subflow", () => {
	/** A review flow: takes a pr, returns a verdict and a report. */
	const reviewFlow = (): Flow => ({
		...withInputs(
			flow(
				[
					agent("review", {
						prompt: "Review {{pr}}",
						output: { type: "object" },
					}),
				],
				[],
				"review",
			),
			[{ name: "pr", type: "text", required: true }],
		),
		outputs: [
			{ name: "verdict", value: "{{review.outcome}}" },
			{ name: "report", value: "{{review.data}}" },
		],
	});

	/** call → report: reads the called flow's outputs. */
	const caller = (
		prompt: string,
		node: SubflowNode = subflow("call", "review", {
			inputs: { pr: "{{pr}}" },
		}),
	): Flow =>
		withInputs(
			flow(
				[node, agent("report", { prompt })],
				[
					edge("a", node.id, "pass", "report"),
					edge("b", node.id, "fail", "report"),
				],
				node.id,
			),
			[{ name: "pr", type: "text" }],
		);

	const flows = () => ({ review: reviewFlow() });

	test("a Subflow node reads the called flow's outputs and its own fields", () => {
		expect(
			validateFlow(
				caller(
					"{{call.verdict}} {{call.report}} {{call.report.score}} {{call.ended}} {{call.visit}} {{call.outcome}}",
				),
				{ flows: flows() },
			),
		).toEqual([]);
	});

	test("an unknown output is an error that lists the fields", () => {
		expect(
			errors(validateFlow(caller("{{call.summary}}"), { flows: flows() })),
		).toEqual([
			expect.objectContaining({
				nodeId: "report",
				message: expect.stringContaining(
					'"call" has no field "summary". Use one of: outcome, ended, visit, verdict, report.',
				),
			}),
		]);
	});

	test("without flows any field of a Subflow node is accepted", () => {
		expect(validateFlow(caller("{{call.whatever.deep}}"))).toEqual([]);
	});

	test("a Subflow node ends with pass or fail", () => {
		const f = caller("x");
		f.edges.push(edge("c", "call", "done", "report"));
		expect(errors(validateFlow(f))).toEqual([
			expect.objectContaining({
				edgeId: "c",
				message: expect.stringContaining("pass, fail"),
			}),
		]);
	});

	test("binding templates are checked", () => {
		const f = caller(
			"x",
			subflow("call", "review", { inputs: { pr: "{{nope}}" } }),
		);
		expect(errors(validateFlow(f))).toEqual([
			expect.objectContaining({
				nodeId: "call",
				message: expect.stringContaining(
					'The input "pr" of "call" uses {{nope}}',
				),
			}),
		]);
	});

	test("the called flow must exist and parse", () => {
		expect(
			errors(validateFlow(caller("x"), { flows: {} })).map((i) => i.message),
		).toEqual([
			'Subflow node "call" runs flow "review", which does not exist.',
		]);
		expect(
			errors(validateFlow(caller("x"), { flows: { review: null } })).map(
				(i) => i.message,
			),
		).toEqual([expect.stringContaining("which is not valid")]);
	});

	test("bindings: declared inputs only, every required input bound", () => {
		const f = caller(
			"x",
			subflow("call", "review", { inputs: { other: "1" } }),
		);
		expect(
			errors(validateFlow(f, { flows: flows() })).map((i) => i.message),
		).toEqual([
			'Subflow node "call" binds the input "other", but flow "review" has no such input.',
			'Subflow node "call" does not bind the required input "pr" of flow "review".',
		]);
	});

	test("errors inside the called flow give one error on the node", () => {
		const broken = reviewFlow();
		broken.outputs.push({ name: "oops", value: "{{ghost.data}}" });
		expect(
			errors(validateFlow(caller("x"), { flows: { review: broken } })),
		).toEqual([
			{
				severity: "error",
				nodeId: "call",
				message: 'Flow "review" of Subflow node "call" has 1 error.',
			},
		]);
	});

	test("a flow that calls itself is an error", () => {
		const self = caller("x", subflow("call", "self", { inputs: { pr: "1" } }));
		expect(
			errors(validateFlow(self, { flows: { self }, name: "self" })),
		).toEqual([
			expect.objectContaining({
				nodeId: "call",
				message: expect.stringContaining("runs this flow again: self → self."),
			}),
		]);
	});

	test("a cycle through Subflow and For Each nodes is an error with the chain", () => {
		// a calls b (Subflow), b runs a per element (For Each).
		const a = withInputs(caller("x", subflow("call", "b", { inputs: {} })), [
			itemInput,
		]);
		const b = flow([foreach("each", "a")], [], "each");
		expect(errors(validateFlow(a, { flows: { a, b }, name: "a" }))).toEqual([
			expect.objectContaining({
				nodeId: "call",
				message: expect.stringContaining("runs this flow again: a → b → a."),
			}),
		]);
	});
});

describe("parseFlow with options", () => {
	test("passes the options to validateFlow", () => {
		const json = {
			version: 2,
			start: "each",
			nodes: [
				{
					id: "each",
					type: "foreach",
					position: { x: 0, y: 0 },
					source: { kind: "command", command: "./list-items" },
					flow: "trace",
				},
			],
			edges: [],
		};
		const parsed = parseFlow(json);
		expect(parsed.issues).toEqual([]);
		expect(parsed.flow?.nodes[0]).toMatchObject({
			as: "item",
			inputs: {},
			branch: "per-item",
			haltOn: ["halt"],
		});
		expect(parsed.flow).toMatchObject({ inputs: [], outputs: [] });
		expect(parseFlow(json, { flows: {} }).issues).toEqual([
			expect.objectContaining({
				message: expect.stringContaining("does not exist"),
			}),
		]);
	});

	test("migrates a version 1 flow first", () => {
		const parsed = parseFlow({
			version: 1,
			params: [{ name: "epic", required: true }],
			start: "worker",
			nodes: [{ ...agent("worker"), prompt: "Epic {{params.epic}}" }],
			edges: [],
		});
		expect(parsed.issues).toEqual([]);
		expect(parsed.flow).toMatchObject({
			version: 2,
			inputs: [{ name: "epic", type: "text", required: true }],
			nodes: [{ prompt: "Epic {{epic}}" }],
		});
	});
});
