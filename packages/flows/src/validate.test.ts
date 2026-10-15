import { describe, expect, test } from "bun:test";
import type {
	AgentNode,
	CommandNode,
	Flow,
	FlowEdge,
	FlowNode,
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
			edges: [{ id: "a", from: "worker", outcome: "maybe", to: "check" }],
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
