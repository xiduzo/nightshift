import { describe, expect, test } from "bun:test";
import { type Flow, flowSchema } from "../document";
import {
	applySuggestion,
	argumentChanges,
	inputChanges,
	outcomeChanges,
	ruleChanges,
	takesSuggestion,
} from "./apply";
import { isFlowSuggestion, suggestionRequestSchema } from "./assistant";

const flow: Flow = flowSchema.parse({
	version: 6,
	start: "review",
	description: "Reviews a change.",
	inputs: [{ name: "pr", type: "text" }],
	nodes: [
		{
			id: "review",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: "worker",
			prompt: "Review {{pr}}.",
			checker: { decider: "typesafe", prompt: "Old brief." },
		},
		{
			id: "gate",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "",
			by: "rule",
			options: [
				{ name: "ship", when: "review.outcome = 'pass'" },
				{ name: "hold" },
			],
		},
		{
			id: "check",
			type: "command",
			position: { x: 0, y: 0 },
			command: "npm test",
		},
		{
			id: "ci",
			type: "wait",
			position: { x: 0, y: 0 },
			until: { kind: "command", command: "true", everyMinutes: 5 },
		},
		{
			id: "pick",
			type: "value",
			position: { x: 0, y: 0 },
			by: "rule",
			expression: "1",
			output: { type: "object" },
		},
		{
			id: "issue",
			type: "tool",
			position: { x: 0, y: 0 },
			connection: "linear",
			tool: "create_issue",
			arguments: { title: "x", gone: "y" },
		},
		{
			id: "traces",
			type: "call",
			position: { x: 0, y: 0 },
			flow: "trace",
			each: {
				source: { kind: "command", command: "cat tasks.json" },
				maxItems: 5,
			},
		},
		{
			id: "files",
			type: "call",
			position: { x: 0, y: 0 },
			flow: "trace",
			each: { source: { kind: "files", glob: "*.md" } },
		},
	],
	edges: [
		{ id: "e1", from: "review", outcome: "pass", to: "gate" },
		{ id: "e2", from: "review", outcome: "fail", to: "check" },
		{ id: "e3", from: "gate", outcome: "ship", to: "check" },
	],
});

const nodeOf = (next: Flow, id: string) =>
	next.nodes.find((node) => node.id === id);

describe("takesSuggestion", () => {
	test("each kind fits the nodes that have its field", () => {
		const takes = (id: string) =>
			(
				[
					"outcomes",
					"rules",
					"expression",
					"command",
					"checker",
					"arguments",
				] as const
			).filter((kind) => {
				const node = nodeOf(flow, id);
				return node ? takesSuggestion(node, kind) : false;
			});
		expect(takes("review")).toEqual(["outcomes", "checker"]);
		expect(takes("gate")).toEqual(["outcomes", "rules"]);
		expect(takes("check")).toEqual(["command"]);
		expect(takes("ci")).toEqual(["command"]);
		expect(takes("pick")).toEqual(["expression"]);
		expect(takes("issue")).toEqual(["arguments"]);
		expect(takes("traces")).toEqual(["command"]);
		expect(takes("files")).toEqual([]);
	});

	test("the description and the inputs belong to the flow, without a node", () => {
		expect(isFlowSuggestion("inputs")).toBe(true);
		expect(isFlowSuggestion("prompt")).toBe(false);
		const request = suggestionRequestSchema.parse({
			projectId: "p",
			flowName: "f",
			flow,
			kind: "description",
		});
		expect(request.nodeId).toBeUndefined();
	});
});

describe("applySuggestion, the newer kinds", () => {
	test("outcomes: a renamed outcome takes its edges, a dropped one loses them", () => {
		const next = applySuggestion(flow, "review", {
			kind: "outcomes",
			outcomes: [
				{ name: "approved", description: "It is good.", from: "pass" },
				{ name: "changes" },
			],
			note: "",
		});
		const review = nodeOf(next, "review");
		expect(review?.type === "agent" ? review.outcomes : undefined).toEqual([
			{ name: "approved", description: "It is good." },
			{ name: "changes" },
		]);
		expect(next.edges.filter((edge) => edge.from === "review")).toEqual([
			{ id: "e1", from: "review", outcome: "approved", to: "gate" },
		]);
	});

	test("outcomes on a Decision keep the rule of the option they replace", () => {
		const next = applySuggestion(flow, "gate", {
			kind: "outcomes",
			outcomes: [{ name: "merge", from: "ship" }, { name: "hold" }],
			note: "",
		});
		const gate = nodeOf(next, "gate");
		expect(gate?.type === "decision" ? gate.options : undefined).toEqual([
			{ name: "merge", when: "review.outcome = 'pass'" },
			{ name: "hold" },
		]);
		expect(next.edges.find((edge) => edge.id === "e3")?.outcome).toBe("merge");
	});

	test("outcomeChanges marks the renamed, new and removed outcomes and counts lost edges", () => {
		const changes = outcomeChanges(flow, "review", [
			{ name: "approved", from: "pass" },
			{ name: "changes" },
		]);
		expect(
			changes.outcomes.map((row) => [row.outcome.name, row.change, row.from]),
		).toEqual([
			["approved", "changed", "pass"],
			["changes", "new", undefined],
			["fail", "removed", undefined],
			["needs-input", "removed", undefined],
		]);
		expect(changes.droppedEdges).toBe(1);
	});

	test("rules change the options they name, and an empty rule drops one", () => {
		const next = applySuggestion(flow, "gate", {
			kind: "rules",
			rules: [
				{ option: "ship", when: "check.exit_code = 0" },
				{ option: "hold", when: "" },
			],
			note: "",
		});
		const gate = nodeOf(next, "gate");
		expect(gate?.type === "decision" ? gate.options : undefined).toEqual([
			{ name: "ship", when: "check.exit_code = 0" },
			{ name: "hold" },
		]);
		expect(
			ruleChanges(flow, "gate", [
				{ option: "ship", when: "check.exit_code = 0" },
			]).map((row) => [row.name, row.change]),
		).toEqual([
			["ship", "changed"],
			["hold", "same"],
		]);
	});

	test("expression, command and checker set their field", () => {
		const expression = nodeOf(
			applySuggestion(flow, "pick", {
				kind: "expression",
				expression: "review.data",
				note: "",
			}),
			"pick",
		);
		expect(expression).toMatchObject({ expression: "review.data" });
		const command = nodeOf(
			applySuggestion(flow, "check", {
				kind: "command",
				command: "bun test",
				note: "",
			}),
			"check",
		);
		expect(command).toMatchObject({ command: "bun test" });
		const wait = nodeOf(
			applySuggestion(flow, "ci", {
				kind: "command",
				command: "gh pr checks",
				note: "",
			}),
			"ci",
		);
		expect(wait).toMatchObject({
			until: { kind: "command", command: "gh pr checks", everyMinutes: 5 },
		});
		const list = nodeOf(
			applySuggestion(flow, "traces", {
				kind: "command",
				command: "gh issue list --json number,title",
				note: "",
			}),
			"traces",
		);
		expect(list).toMatchObject({
			each: {
				source: {
					kind: "command",
					command: "gh issue list --json number,title",
				},
				maxItems: 5,
			},
		});
		const checker = nodeOf(
			applySuggestion(flow, "review", { kind: "checker", text: "", note: "" }),
			"review",
		);
		expect(checker).toMatchObject({ checker: { decider: "typesafe" } });
		expect(checker?.type === "agent" && checker.checker).not.toHaveProperty(
			"prompt",
		);
	});

	test("a kind on a node without its field leaves the flow as it is", () => {
		expect(
			applySuggestion(flow, "check", {
				kind: "expression",
				expression: "x",
				note: "",
			}),
		).toBe(flow);
	});

	test("arguments replace the Tool node's", () => {
		const args = { title: "{{pr}}", team: "web" };
		const next = applySuggestion(flow, "issue", {
			kind: "arguments",
			arguments: args,
			note: "",
		});
		expect(nodeOf(next, "issue")).toMatchObject({ arguments: args });
		const issue = nodeOf(flow, "issue");
		expect(
			issue &&
				argumentChanges(issue, args).map((row) => [row.name, row.change]),
		).toEqual([
			["title", "changed"],
			["team", "new"],
			["gone", "removed"],
		]);
	});

	test("description and inputs change the flow, with no node", () => {
		const described = applySuggestion(flow, undefined, {
			kind: "description",
			description: "  Reviews and ships a change. ",
			note: "",
		});
		expect(described.description).toBe("Reviews and ships a change.");
		expect(
			applySuggestion(flow, undefined, {
				kind: "description",
				description: "",
				note: "",
			}),
		).not.toHaveProperty("description");
		const inputs = [
			{ name: "pr", type: "text" as const, description: "The pull request" },
			{ name: "repo", type: "text" as const },
		];
		const next = applySuggestion(flow, undefined, {
			kind: "inputs",
			inputs,
			note: "",
		});
		expect(next.inputs).toEqual(inputs);
		expect(
			inputChanges(flow, inputs).map((row) => [row.name, row.change]),
		).toEqual([
			["pr", "changed"],
			["repo", "new"],
		]);
	});
});
