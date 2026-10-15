import { describe, expect, test } from "bun:test";
import type {
	AgentNode,
	CommandNode,
	DecisionNode,
	Flow,
	FlowEdge,
	FlowNode,
	GateNode,
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
		tools: [],
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
		tools: [],
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
	return { version: 1, start, nodes, edges };
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
				tools: ["github"],
			}),
			decision("decide", ["continue", "stop"], {
				prompt: "The worker reported: {{worker.summary}}. Go on?",
				tools: ["github"],
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
		delete json.nodes[1].tools;
		const parsed = parseFlow(json);
		expect(parsed.issues).toEqual([]);
		expect(parsed.flow?.nodes[1]).toMatchObject({
			decider: "claude-code",
			model: "haiku",
			tools: [],
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
			version: 1,
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
