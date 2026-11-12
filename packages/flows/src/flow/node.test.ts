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
	endedLabel,
	endsFlow,
	NODE_DEFINITIONS,
	NODE_FAMILY,
	NODE_TYPE_LABEL,
	nodeOutcomes,
	outcomeColor,
	outputFieldsByType,
	standInOutcomes,
	standsIn,
	touchesDevice,
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

describe("endsFlow and endedLabel: what the engine's walk does with no edge", () => {
	test("pass is the chosen end of an Agent, a Tool, a Value, a Convert and a Web request; fail and needs-input are not", () => {
		for (const type of [
			"agent",
			"tool",
			"value",
			"convert",
			"web-request",
		] as const) {
			const node = sample(type);
			expect(endsFlow(node, "pass"), type).toBe(true);
			expect(endsFlow(node, "fail"), type).toBe(false);
			expect(endsFlow(node, "needs-input"), type).toBe(false);
			expect(endedLabel(node, "pass"), type).toBe("");
		}
	});

	test("an Agent's own outcome is a chosen end, and a Call reports it", () => {
		const own = sampleWith("agent", {
			outcomes: [{ name: "shipped" }, { name: "fail" }],
		});
		expect(endsFlow(own, "shipped")).toBe(true);
		expect(endedLabel(own, "shipped")).toBe("shipped");
		expect(endsFlow(own, "fail")).toBe(false);
		expect(endedLabel(own, "fail")).toBe("");
		expect(endsFlow(own, "needs-input")).toBe(false);
		expect(endsFlow(sample("agent"), "shipped")).toBe(false);
	});

	test("a Command's exit on code 0 is its chosen end, whatever its name", () => {
		const exits = sampleWith("command", {
			exits: [
				{ name: "clean", code: 0 },
				{ name: "dirty", code: 1 },
				{ name: "broken" },
			],
		});
		expect(endsFlow(exits, "clean")).toBe(true);
		expect(endsFlow(exits, "dirty")).toBe(false);
		expect(endsFlow(exits, "broken")).toBe(false);
		expect(endsFlow(exits, "pass")).toBe(false);
		expect(endedLabel(exits, "clean")).toBe("");
	});

	test("every Decision option is a chosen end, and its label", () => {
		for (const by of ["person", "rule", "model"]) {
			const node = sampleWith("decision", { by });
			expect(endsFlow(node, "yes"), by).toBe(true);
			expect(endedLabel(node, "yes"), by).toBe("yes");
		}
	});

	test("a Wait ends plainly when done, on its own outcome with its label; a timeout fails", () => {
		const until = { kind: "signal", name: "ci" };
		const own = sampleWith("wait", { until, outcomes: [{ name: "green" }] });
		expect(endsFlow(sample("wait"), "done")).toBe(true);
		expect(endedLabel(sample("wait"), "done")).toBe("");
		expect(endsFlow(sample("wait"), "timeout")).toBe(false);
		expect(endsFlow(own, "green")).toBe(true);
		expect(endedLabel(own, "green")).toBe("green");
	});

	test("a Lease that is held, a Service that is ready and a Join that is done end plainly", () => {
		expect(endsFlow(sample("lease"), "held")).toBe(true);
		expect(endsFlow(sample("lease"), "busy")).toBe(false);
		expect(endsFlow(sample("service"), "ready")).toBe(true);
		expect(endsFlow(sample("service"), "failed")).toBe(false);
		expect(endsFlow(sample("join"), "done")).toBe(true);
		for (const type of ["lease", "service", "join"] as const) {
			expect(
				endedLabel(sample(type), nodeOutcomes(sample(type))[0] ?? ""),
				type,
			).toBe("");
		}
	});

	test("every outcome of Since last run is a chosen end, and its label", () => {
		for (const outcome of ["new", "changed", "same"]) {
			expect(endsFlow(sample("since-last-run"), outcome)).toBe(true);
			expect(endedLabel(sample("since-last-run"), outcome)).toBe(outcome);
		}
		expect(endsFlow(sample("since-last-run"), "pass")).toBe(false);
	});

	test("a Call once ends on pass; a Call with each on any outcome", () => {
		const once = sampleWith("call", { each: undefined });
		expect(endsFlow(once, "pass")).toBe(true);
		expect(endsFlow(once, "fail")).toBe(false);
		for (const outcome of ["done", "halted", "pass"]) {
			expect(endsFlow(sample("call"), outcome)).toBe(true);
		}
		expect(endedLabel(once, "pass")).toBe("");
	});

	test("an End is a chosen end whatever its status, and its status is the label", () => {
		for (const status of ["done", "nothing-to-do", "failed"]) {
			const node = sampleWith("end", { status });
			expect(endsFlow(node, status)).toBe(true);
			expect(endedLabel(node, status)).toBe(status);
		}
	});
});

describe("touchesDevice: what a step runs on its computer", () => {
	test("a process, a session, a tool, a web request or a model", () => {
		expect(everyType((type) => touchesDevice(sample(type)))).toEqual({
			agent: true,
			command: true,
			// The sample Gate: a person decides.
			decision: false,
			// The sample lists its items in JSON.
			call: false,
			// The sample Value: a rule makes it.
			value: false,
			// The sample waits for a time.
			wait: false,
			tool: true,
			end: false,
			join: false,
			lease: false,
			service: true,
			"since-last-run": false,
			convert: false,
			"web-request": true,
		});
	});

	test("a Decision and a Value by a model, a Wait that polls, and a Call whose list comes from a command", () => {
		expect(touchesDevice(sampleWith("decision", { by: "model" }))).toBe(true);
		expect(touchesDevice(sampleWith("value", { by: "model" }))).toBe(true);
		const command = { command: "ci-state", everyMinutes: 5 };
		expect(
			touchesDevice(
				sampleWith("wait", { until: { kind: "command", ...command } }),
			),
		).toBe(true);
		expect(
			touchesDevice(
				sampleWith("wait", {
					until: { kind: "any", signal: { name: "ci" }, command },
				}),
			),
		).toBe(true);
		expect(
			touchesDevice(
				sampleWith("wait", {
					until: { kind: "url", url: "https://x.example", everyMinutes: 5 },
				}),
			),
		).toBe(true);
		expect(
			touchesDevice(
				sampleWith("wait", { until: { kind: "signal", name: "ci" } }),
			),
		).toBe(false);
		expect(
			touchesDevice(
				sampleWith("call", {
					each: { source: { kind: "command", command: "ls" }, as: "item" },
				}),
			),
		).toBe(true);
		expect(touchesDevice(sampleWith("call", { each: undefined }))).toBe(false);
	});
});

describe("typedOutputField and mainOutputField", () => {
	test("the field each sample's own output schema types, and the field that holds what it made", () => {
		expect(
			everyType((type) => [
				NODE_DEFINITIONS[type].typedOutputField(sample(type) as never),
				NODE_DEFINITIONS[type].mainOutputField(sample(type) as never),
			]),
		).toEqual({
			agent: ["data", "data"],
			command: ["data", "log_tail"],
			decision: [null, "note"],
			call: [null, "results"],
			value: ["data", "data"],
			wait: [null, "waited_minutes"],
			tool: ["data", "data"],
			end: [null, "message"],
			join: [null, "data"],
			lease: [null, "holder"],
			service: [null, "data"],
			"since-last-run": [null, "data"],
			convert: ["data", "data"],
			"web-request": ["body", "body"],
		});
	});

	test("a Convert to text has no output schema", () => {
		const text = sampleWith("convert", { from: "html", to: "text" });
		expect(NODE_DEFINITIONS.convert.typedOutputField(text as never)).toBeNull();
		expect(NODE_DEFINITIONS.convert.mainOutputField(text as never)).toBe(
			"text",
		);
	});
});

describe("newNodes", () => {
	test("each kind of the palette makes a node of its type, at its place", () => {
		for (const type of TYPES) {
			for (const [kind, made] of Object.entries(
				NODE_DEFINITIONS[type].newNodes,
			)) {
				const node = made.create(made.id, { x: 3, y: 4 }, {});
				expect(node.type, kind).toBe(type);
				expect(node.id, kind).toBe(made.id);
				expect(node.position, kind).toEqual({ x: 3, y: 4 });
			}
		}
	});
});
