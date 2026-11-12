import { describe, expect, test } from "bun:test";
import { NODE_FAMILIES, type NodeCheck } from "../nodes";
import { checkNodeWith } from "../validate";
import {
	FLOW_VERSION,
	type FlowNode,
	type FlowNodeType,
	flowNodeSchema,
	flowSchema,
} from "./flow";
import {
	NODE_DEFINITIONS,
	NODE_FAMILY,
	NODE_TYPE_LABEL,
	nodeOutcomes,
	outcomeColor,
	outputFieldsByType,
	standInOutcomes,
	standsIn,
} from "./node";

/**
 * The node type definitions as a table: one fact, every type. Each node
 * type's file holds its facts (`NodeDefinition`), and these tables pin
 * them, so a new type shows up here first and an old one cannot drift.
 */

const TYPES = Object.keys(NODE_DEFINITIONS) as FlowNodeType[];

/** A node as the schema reads it, defaults filled in. */
function parsed(node: Record<string, unknown>): FlowNode {
	return flowSchema.parse({
		version: FLOW_VERSION,
		start: node.id,
		nodes: [node],
		edges: [],
	}).nodes[0] as FlowNode;
}

/** The sample node of a type, as the schema reads it. */
const sample = (type: FlowNodeType): FlowNode =>
	parsed(NODE_DEFINITIONS[type].sample);

/** The sample with some fields changed. */
const sampleWith = (
	type: FlowNodeType,
	fields: Record<string, unknown>,
): FlowNode => parsed({ ...NODE_DEFINITIONS[type].sample, ...fields });

/** One value per type, for a table that pins a fact of every type. */
function everyType<V>(
	fact: (type: FlowNodeType) => V,
): Record<FlowNodeType, V> {
	return Object.fromEntries(TYPES.map((type) => [type, fact(type)])) as Record<
		FlowNodeType,
		V
	>;
}

describe("NODE_DEFINITIONS", () => {
	test("has one definition per type of the flow schema, keyed by its own type", () => {
		const schemaTypes = flowNodeSchema.options.map(
			(option) => option.shape.type.value,
		);
		expect([...TYPES].sort()).toEqual([...schemaTypes].sort());
		for (const type of TYPES) expect(NODE_DEFINITIONS[type].type).toBe(type);
	});

	test("every sample is a valid node of its type", () => {
		for (const type of TYPES) {
			const node = NODE_DEFINITIONS[type].sample;
			const result = flowSchema.safeParse({
				version: FLOW_VERSION,
				start: node.id,
				nodes: [node],
				edges: [],
			});
			expect(result.success, type).toBe(true);
			expect(node.type).toBe(type);
		}
	});
});

describe("label and family", () => {
	test("what a person calls each type, and its family", () => {
		expect(everyType((type) => NODE_TYPE_LABEL[type])).toEqual({
			agent: "Agent",
			command: "Command",
			decision: "Decision",
			call: "Subflow",
			value: "Value",
			wait: "Wait",
			tool: "Tool",
			end: "End",
			join: "Join",
			lease: "Lease",
			service: "Service",
			"since-last-run": "Since last run",
			convert: "Convert",
			"web-request": "Web request",
		});
		expect(everyType((type) => NODE_FAMILY[type])).toEqual({
			agent: "do",
			command: "do",
			tool: "do",
			"web-request": "do",
			decision: "decide",
			value: "shape",
			"since-last-run": "shape",
			convert: "shape",
			wait: "hold",
			lease: "hold",
			service: "hold",
			call: "compose",
			join: "compose",
			end: "compose",
		});
		for (const type of TYPES) {
			expect(NODE_FAMILIES).toContain(NODE_FAMILY[type]);
		}
	});
});

describe("outcomes", () => {
	test("the outcomes of each sample, in the order its handles show", () => {
		expect(everyType((type) => nodeOutcomes(sample(type)))).toEqual({
			agent: ["pass", "fail", "needs-input"],
			command: ["pass", "fail"],
			decision: ["yes", "no"],
			// The sample runs once per element.
			call: ["done", "halted", "stopped"],
			value: ["pass", "fail"],
			wait: ["done", "timeout"],
			tool: ["pass", "fail"],
			end: [],
			join: ["done"],
			lease: ["held", "busy"],
			service: ["ready", "failed"],
			"since-last-run": ["new", "changed", "same"],
			convert: ["pass", "fail"],
			"web-request": ["pass", "fail"],
		});
	});

	test("an Agent's own outcomes replace the default ones, and one that asks a person never ends on needs-input", () => {
		const own = sampleWith("agent", {
			outcomes: [{ name: "shipped" }, { name: "needs-input" }],
		});
		expect(nodeOutcomes(own)).toEqual(["shipped", "needs-input"]);
		expect(nodeOutcomes(sampleWith("agent", { ask: "person" }))).toEqual([
			"pass",
			"fail",
		]);
	});

	test("a Decision with a cascade and no person tier can end fail", () => {
		const tier = { profile: { device: "d", profile: "small" } };
		expect(
			nodeOutcomes(sampleWith("decision", { by: "model", cascade: [tier] })),
		).toEqual(["yes", "no", "fail"]);
		expect(
			nodeOutcomes(
				sampleWith("decision", {
					by: "model",
					cascade: [tier, { person: true }],
				}),
			),
		).toEqual(["yes", "no"]);
	});

	test("a Call once passes or fails; a Wait gives its own outcomes first", () => {
		expect(nodeOutcomes(sampleWith("call", { each: undefined }))).toEqual([
			"pass",
			"fail",
			"stopped",
		]);
		const until = { kind: "command", command: "ci-state", everyMinutes: 5 };
		expect(
			nodeOutcomes(
				sampleWith("wait", {
					until,
					outcomes: [{ name: "green" }, { name: "red" }],
				}),
			),
		).toEqual(["green", "red", "done", "timeout"]);
	});

	test("a stand-in gives one of the node's outcomes, never stopped", () => {
		expect(standInOutcomes(sample("decision"))).toEqual(["yes", "no"]);
		expect(standInOutcomes(sampleWith("call", { each: undefined }))).toEqual([
			"pass",
			"fail",
		]);
	});
});

describe("outcomeColor", () => {
	test("an Agent's own outcome, a Command's exit, a Decision's option and a Wait's own outcome take their colour", () => {
		const colored = { name: "red", color: "red" };
		expect(
			outcomeColor(sampleWith("agent", { outcomes: [colored] }), "red"),
		).toBe("red");
		expect(
			outcomeColor(
				sampleWith("command", { exits: [{ ...colored, code: 1 }] }),
				"red",
			),
		).toBe("red");
		expect(
			outcomeColor(sampleWith("decision", { options: [colored] }), "red"),
		).toBe("red");
		const until = { kind: "signal", name: "ci" };
		expect(
			outcomeColor(sampleWith("wait", { until, outcomes: [colored] }), "red"),
		).toBe("red");
	});

	test("no sample sets a colour, and no other type has one", () => {
		for (const type of TYPES) {
			const node = sample(type);
			for (const outcome of nodeOutcomes(node)) {
				expect(
					outcomeColor(node, outcome),
					`${type} ${outcome}`,
				).toBeUndefined();
			}
		}
	});
});

describe("standsIn: what a test run may pin or skip (ADR 27)", () => {
	test("an End, a Join, a Lease and a Service always run", () => {
		expect(everyType((type) => standsIn({ type }))).toEqual({
			agent: true,
			command: true,
			decision: true,
			call: true,
			value: true,
			wait: true,
			tool: true,
			end: false,
			join: false,
			lease: false,
			service: false,
			"since-last-run": true,
			convert: true,
			"web-request": true,
		});
	});
});

describe("outputFields", () => {
	test("the fields a later node reads, by type", () => {
		expect(everyType((type) => [...outputFieldsByType[type]])).toEqual({
			agent: [
				"outcome",
				"output",
				"summary",
				"data",
				"note",
				"visit",
				"session_id",
			],
			command: ["outcome", "exit_code", "log_tail", "data", "visit"],
			decision: ["outcome", "note", "visit"],
			call: ["outcome", "ended", "end_message", "end_report", "visit"],
			value: ["outcome", "data", "note", "visit"],
			wait: ["outcome", "waited_minutes", "log_tail", "data", "visit"],
			tool: ["outcome", "data", "text", "visit"],
			end: ["outcome", "message", "report", "visit"],
			join: ["outcome", "data", "visit"],
			lease: [
				"outcome",
				"name",
				"holder",
				"holder_title",
				"waited_minutes",
				"visit",
			],
			service: ["outcome", "data", "log_tail", "visit"],
			"since-last-run": ["outcome", "data", "visit"],
			convert: ["outcome", "data", "text", "note", "visit"],
			"web-request": ["outcome", "status", "headers", "body", "visit"],
		});
	});
});

describe("secrets", () => {
	const none = () => null;

	test("the secrets each sample names, before a run", () => {
		expect(
			everyType((type) => [
				...NODE_DEFINITIONS[type].secrets(sample(type) as never, none),
			]),
		).toEqual({
			agent: [],
			command: [],
			decision: [],
			call: [],
			value: [],
			wait: [],
			tool: [],
			end: [],
			join: [],
			lease: [],
			service: [],
			"since-last-run": [],
			convert: [],
			"web-request": ["API_TOKEN"],
		});
	});
});

describe("check", () => {
	/** The issues of the node's own checks, with every template and rule read as fine. */
	function issuesOf(node: FlowNode): string[] {
		const issues: string[] = [];
		const check: NodeCheck = {
			error: (message) => issues.push(message),
			warning: (message) => issues.push(message),
			template: () => {},
			commandTemplate: () => {},
			rule: () => {},
			eventRule: () => {},
			dataRule: () => {},
			routed: () => true,
			section: () => null,
		};
		checkNodeWith(node, check);
		return issues;
	}

	test("every sample passes the checks of its type", () => {
		for (const type of TYPES) expect(issuesOf(sample(type)), type).toEqual([]);
	});

	test("each type runs its own checks", () => {
		expect(
			issuesOf(sampleWith("command", { secrets: ["TOKEN", "TOKEN"] })),
		).not.toEqual([]);
		expect(issuesOf(sampleWith("lease", { timeoutMinutes: 5 }))).not.toEqual(
			[],
		);
	});
});
