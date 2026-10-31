import { describe, expect, test } from "bun:test";
import type { Flow, FlowEdge, FlowNode } from "../flow";
import { nodeOutcomes, nodeOutputFields, tierNode } from "../flow";
import type { AgentNode, CallNode, DecisionNode, ValueNode } from "../nodes";
import { validateFlow } from "./flow";
import type { FlowIssue } from "./issues";

const at = { x: 0, y: 0 };
const ref = (profile: string) => ({ device: "mac", profile });

function agent(extra: Partial<AgentNode> = {}): AgentNode {
	return {
		id: "worker",
		type: "agent",
		position: at,
		prompt: "Make the tests pass",
		permissionMode: "acceptEdits",
		session: "fresh",
		cascade: [
			{ profile: ref("sonnet"), tries: 2 },
			{ profile: ref("opus"), label: "rescue" },
		],
		check: "bun test",
		...extra,
	};
}

function decision(extra: Partial<DecisionNode> = {}): DecisionNode {
	return {
		id: "triage",
		type: "decision",
		position: at,
		prompt: "Is this a bug?",
		options: [{ name: "bug" }, { name: "feature" }],
		by: "model",
		cascade: [
			{ decider: "typesafe", minConfidence: 0.8 },
			{ decider: "openrouter", label: "strong", minConfidence: 0.6 },
			{ person: true },
		],
		...extra,
	};
}

function value(extra: Partial<ValueNode> = {}): ValueNode {
	return {
		id: "plan",
		type: "value",
		position: at,
		by: "model",
		prompt: "Plan the work",
		output: { type: "object", properties: { tasks: { type: "array" } } },
		cascade: [
			{ decider: "ollama", accept: "$count(data.tasks) > 0" },
			{ decider: "openrouter" },
		],
		...extra,
	};
}

function call(extra: Partial<CallNode> = {}): CallNode {
	return {
		id: "fix",
		type: "call",
		position: at,
		flow: "quick-fix",
		inputs: { issue: "{{issue}}" },
		cascade: [
			{ tries: 2 },
			{
				flow: "deep-fix",
				inputs: { issue: "{{issue}}", before: "{{cascade.previous}}" },
			},
		],
		...extra,
	};
}

function flow(nodes: FlowNode[], edges: FlowEdge[] = []): Flow {
	return {
		version: 7,
		inputs: [{ name: "issue", type: "text" }],
		outputs: [],
		start: nodes[0]?.id ?? "",
		nodes,
		edges,
	};
}

const errors = (issues: FlowIssue[]) =>
	issues.filter((issue) => issue.severity === "error").map((i) => i.message);

const body = (...inputs: string[]): Flow => ({
	version: 7,
	inputs: inputs.map((name) => ({ name, type: "text" as const })),
	outputs: [],
	start: "work",
	nodes: [
		{
			id: "work",
			type: "command",
			position: at,
			command: "true",
			output: "text",
		},
	],
	edges: [],
});

describe("a cascade on a node (ADR 6)", () => {
	test("an Agent with tiers and a check is valid", () => {
		expect(errors(validateFlow(flow([agent()])))).toEqual([]);
	});

	test("a cascade replaces the profile, harness and model of an Agent", () => {
		const issues = errors(
			validateFlow(flow([agent({ profile: ref("x"), model: "opus" })])),
		);
		expect(issues).toEqual([
			'Agent node "worker" has a cascade and a profile and a model. The tiers of the cascade name the agents. Remove them from the node.',
		]);
	});

	test("a check needs a cascade", () => {
		const issues = errors(
			validateFlow(
				flow([
					agent({
						cascade: undefined,
						harness: "claude-code",
						model: "sonnet",
					}),
				]),
			),
		);
		expect(issues[0]).toContain("has a check, but no cascade");
	});

	test("an Agent tier without a profile needs its own harness and model", () => {
		const issues = errors(
			validateFlow(flow([agent({ cascade: [{ tries: 2 }] })])),
		);
		expect(issues).toEqual([
			'The tier "1" of Agent node "worker" needs a profile, or its own harness, model.',
		]);
	});

	test("only the last tier can be a person, and its deadline chooses a retry choice", () => {
		const issues = errors(
			validateFlow(
				flow([
					agent({
						cascade: [
							{ person: true, deadline: { minutes: 30, choose: "approve" } },
							{ profile: ref("opus") },
						],
					}),
				]),
			),
		);
		expect(issues).toEqual([
			'Agent node "worker" has a person tier before other tiers. Only the last tier can be a person.',
			'The deadline of the person tier of "worker" chooses "approve", which the person cannot choose. Choose one of: try-again, stop.',
		]);
	});

	test("tier names are unique", () => {
		const issues = errors(
			validateFlow(
				flow([
					agent({
						cascade: [
							{ profile: ref("a"), label: "cheap" },
							{ profile: ref("b"), label: "cheap" },
						],
					}),
				]),
			),
		);
		expect(issues[0]).toContain('has the tier "cheap" more than once');
	});

	test("a Decision cascade with a person tier is valid, and only a model climbs one", () => {
		expect(errors(validateFlow(flow([decision()])))).toEqual([]);
		const issues = errors(
			validateFlow(flow([decision({ by: "person", prompt: "Bug?" })])),
		);
		expect(issues).toContain(
			'Decision node "triage" has a cascade, but you decide it. Only a model climbs a cascade. Remove the cascade, or let a model decide.',
		);
	});

	test("a decider without a probability is only the last model tier, without a minimum", () => {
		const early = errors(
			validateFlow(
				flow([
					decision({
						cascade: [{ decider: "ollama" }, { decider: "typesafe" }],
					}),
				]),
			),
		);
		expect(early[0]).toContain("Only the last model tier can use it");
		const minimum = errors(
			validateFlow(
				flow([
					decision({
						cascade: [
							{ decider: "typesafe", minConfidence: 0.9 },
							{ decider: "ollama", minConfidence: 0.5 },
							{ person: true },
						],
					}),
				]),
			),
		);
		expect(minimum[0]).toContain("cannot test a minimum confidence");
		const last = errors(
			validateFlow(
				flow([
					decision({
						cascade: [
							{ decider: "typesafe", minConfidence: 0.9 },
							{ decider: "ollama" },
							{ person: true },
						],
					}),
				]),
			),
		);
		expect(last).toEqual([]);
	});

	test("a Decision with a cascade may not have an option named fail", () => {
		const issues = errors(
			validateFlow(
				flow([decision({ options: [{ name: "pass" }, { name: "fail" }] })]),
			),
		);
		expect(issues[0]).toContain('an option named "fail"');
	});

	test("a Decision cascade without a person ends on fail, a field more", () => {
		const climbing = decision({
			cascade: [{ decider: "typesafe", minConfidence: 0.7 }],
		});
		expect(nodeOutcomes(climbing)).toEqual(["bug", "feature", "fail"]);
		expect(nodeOutcomes(decision())).toEqual(["bug", "feature"]);
		expect(nodeOutputFields(climbing)).toEqual([
			"outcome",
			"note",
			"visit",
			"tier",
			"tries",
			"confidence",
		]);
	});

	test("a Value can end its cascade with a person, and its accept rule reads data only", () => {
		expect(errors(validateFlow(flow([value()])))).toEqual([]);
		const issues = errors(
			validateFlow(
				flow([
					value({
						cascade: [
							{ decider: "openrouter", accept: "issue = 1" },
							{ person: true },
						],
					}),
				]),
			),
		);
		expect(issues).toEqual([
			'The accept rule of the tier "1" of "plan" reads "issue", but it can only read the value as data: $count(data.tasks) > 0.',
		]);
	});

	test("a Value tier's decider must make a value", () => {
		const issues = errors(
			validateFlow(flow([value({ cascade: [{ decider: "typesafe" }] })])),
		);
		expect(issues[0]).toContain("which cannot make a value");
	});

	test("a model tier sets no address", () => {
		const issues = errors(
			validateFlow(
				flow([
					decision({
						cascade: [
							{
								decider: "openai",
								address: { baseUrl: "https://models.example.com" },
							},
						],
					}),
				]),
			),
		);
		expect(issues[0]).toContain(
			'The tier "1" of Decision node "triage" sets an address',
		);
	});

	test("a Call cascade checks each tier's flow and inputs", () => {
		const flows = {
			"quick-fix": body("issue"),
			"deep-fix": body("issue", "before"),
		};
		expect(errors(validateFlow(flow([call()]), { flows }))).toEqual([]);
		const missing = errors(
			validateFlow(flow([call()]), { flows: { "quick-fix": body("issue") } }),
		);
		expect(missing).toContain(
			'Subflow node "fix" runs flow "deep-fix", which does not exist.',
		);
	});

	test("a tier on another flow binds only its own inputs", () => {
		const node = call();
		expect(tierNode(node, 0)?.inputs).toEqual({ issue: "{{issue}}" });
		expect(tierNode(node, 1)?.flow).toBe("deep-fix");
		expect(tierNode(node, 1)?.inputs).toEqual({
			issue: "{{issue}}",
			before: "{{cascade.previous}}",
		});
	});

	test("a Call with each takes no cascade", () => {
		const issues = errors(
			validateFlow(
				flow([
					call({
						each: {
							source: { kind: "json", value: "[]" },
							as: "issue",
							branch: "shared",
							haltOn: ["halt"],
						},
					}),
				]),
				{
					flows: {
						"quick-fix": body("issue"),
						"deep-fix": body("issue", "before"),
					},
				},
			),
		);
		expect(issues).toContain(
			'Subflow node "fix" has a cascade and runs its flow for each element. A cascade climbs one run of a flow. Remove the cascade, or the list.',
		);
	});

	test("only a node with a cascade reads cascade in a template", () => {
		const reads = agent({
			prompt:
				"Try {{cascade.try}} on {{cascade.tier}}: {{cascade.previous.log_tail}}",
		});
		expect(errors(validateFlow(flow([reads])))).toEqual([]);
		const plain = agent({
			cascade: undefined,
			check: undefined,
			harness: "claude-code",
			model: "sonnet",
			prompt: "Try {{cascade.try}}",
		});
		expect(errors(validateFlow(flow([plain])))[0]).toContain(
			"only a node with a cascade can read cascade",
		);
		const wrong = agent({ prompt: "{{cascade.tier.name}} {{cascade.round}}" });
		expect(errors(validateFlow(flow([wrong])))).toEqual([
			'The prompt of "worker" uses {{cascade.tier.name}}, but cascade.tier takes no path.',
			'The prompt of "worker" uses {{cascade.round}}, but the cascade has no field "round". Use one of: tier, try, previous.',
		]);
	});

	test("a Value's person tier is an Ask: its deadline accepts the best answer or fails", () => {
		const asked = (choose: string) =>
			errors(
				validateFlow(
					flow([
						value({
							cascade: [
								{ decider: "openrouter" },
								{ person: true, deadline: { minutes: 30, choose } },
							],
						}),
					]),
				),
			);
		expect(asked("accept")).toEqual([]);
		expect(asked("fail")).toEqual([]);
		expect(asked("stop")).toEqual([
			'The deadline of the person tier of "plan" chooses "stop", which the person cannot choose. Choose one of: accept, fail.',
		]);
	});
});
