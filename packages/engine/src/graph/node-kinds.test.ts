import { describe, expect, test } from "bun:test";
import type {
	AgentNode,
	CallNode,
	CommandNode,
	DecisionNode,
	FlowNode,
	FlowNodeType,
	Outcome,
	ToolNode,
	ValueNode,
	WaitNode,
} from "@nightshift/flows";

import type { DerivedItem, DerivedStep } from "../events";
import type { DaemonHas } from "./context";
import { kindOf, kindOfType, NODE_KINDS } from "./node-kinds";
import { RESUME_RULES } from "./resume-point";

/**
 * The node-kind descriptors as a table: one fact, every kind. Each table
 * pins what the switches said before the descriptor took them over
 * (`compile.ts`, `route.ts`, the step runner, `runner.closeParked`,
 * `body.endedLabel`, `run-start.REQUIREMENTS`), so a new kind shows up
 * here first and an old one cannot drift.
 */

const node = <N extends FlowNode>(fields: Record<string, unknown>): N =>
	({ id: "n", position: { x: 0, y: 0 }, ...fields }) as unknown as N;

const agent = (fields: Record<string, unknown> = {}) =>
	node<AgentNode>({ type: "agent", prompt: "work", ...fields });
const command = (fields: Record<string, unknown> = {}) =>
	node<CommandNode>({ type: "command", command: "true", ...fields });
const tool = (fields: Record<string, unknown> = {}) =>
	node<ToolNode>({
		type: "tool",
		connection: "github",
		tool: "search",
		...fields,
	});
const decision = (
	by: DecisionNode["by"],
	fields: Record<string, unknown> = {},
) =>
	node<DecisionNode>({
		type: "decision",
		by,
		options: [{ name: "yes" }, { name: "no" }],
		...fields,
	});
const value = (by: ValueNode["by"], fields: Record<string, unknown> = {}) =>
	node<ValueNode>({ type: "value", by, ...fields });
const wait = (
	until: Record<string, unknown>,
	fields: Record<string, unknown> = {},
) => node<WaitNode>({ type: "wait", until, ...fields });
const call = (fields: Record<string, unknown> = {}) =>
	node<CallNode>({ type: "call", flow: "other", ...fields });
const callEach = (source: Record<string, unknown> = { kind: "json" }) =>
	call({ each: { source } });

const ALL_TYPES: FlowNodeType[] = [
	"agent",
	"command",
	"tool",
	"decision",
	"value",
	"wait",
	"call",
];

describe("NODE_KINDS", () => {
	test("has one descriptor per node type, keyed by its own type", () => {
		expect(Object.keys(NODE_KINDS).sort()).toEqual([...ALL_TYPES].sort());
		for (const type of ALL_TYPES) {
			expect(kindOfType(type).type).toBe(type);
		}
	});

	test("kindOf answers for a node what kindOfType answers for its type", () => {
		for (const n of [
			agent(),
			command(),
			tool(),
			decision("rule"),
			value("rule"),
			wait({ kind: "duration", minutes: 1 }),
			call(),
		]) {
			expect(kindOf(n)).toBe(kindOfType(n.type));
		}
	});
});

describe("make and resumeRules", () => {
	test("every kind has a factory and names its RESUME_RULES entry", () => {
		const table: [
			FlowNode,
			(typeof RESUME_RULES)[keyof typeof RESUME_RULES],
		][] = [
			[agent(), RESUME_RULES.agent],
			[command(), RESUME_RULES.fresh],
			[tool(), RESUME_RULES.fresh],
			[decision("person"), RESUME_RULES.gate],
			[decision("rule"), RESUME_RULES.fresh],
			[decision("model"), RESUME_RULES.model],
			[value("rule"), RESUME_RULES.fresh],
			[value("model"), RESUME_RULES.model],
			[wait({ kind: "duration", minutes: 1 }), RESUME_RULES.wait],
			[call(), RESUME_RULES.call],
			[callEach(), RESUME_RULES.callEach],
		];
		for (const [n, rules] of table) {
			expect(typeof kindOf(n).make).toBe("function");
			expect(kindOf(n).resumeRules(n)).toBe(rules);
		}
	});
});

describe("aux: the auxiliary graph nodes compile.ts adds", () => {
	const auxKinds = (n: FlowNode) =>
		kindOf(n)
			.aux(n)
			.map((a) => a.kind);

	test("an Agent, a model Decision, a model Value and a Wait have a wait node", () => {
		expect(auxKinds(agent())).toEqual(["wait"]);
		expect(auxKinds(decision("model"))).toEqual(["wait"]);
		expect(auxKinds(value("model"))).toEqual(["wait"]);
		expect(auxKinds(wait({ kind: "duration", minutes: 1 }))).toEqual(["wait"]);
	});

	test("a person Decision (a Gate) has an ask node with its own factory", () => {
		const aux = kindOf(decision("person")).aux(decision("person"));
		expect(aux.map((a) => a.kind)).toEqual(["ask"]);
		expect(aux[0]?.kind === "ask" && typeof aux[0].make).toBe("function");
	});

	test("a Command, a Tool, a Call and a rule Decision or Value have the park node only", () => {
		expect(auxKinds(command())).toEqual([]);
		expect(auxKinds(tool())).toEqual([]);
		expect(auxKinds(call())).toEqual([]);
		expect(auxKinds(callEach())).toEqual([]);
		expect(auxKinds(decision("rule"))).toEqual([]);
		expect(auxKinds(value("rule"))).toEqual([]);
	});
});

describe("isChosenEnd and endReason: what route() does with no edge", () => {
	const chosen = (n: FlowNode, outcome: Outcome) =>
		kindOf(n).isChosenEnd(n, outcome);
	const reason = (n: FlowNode, outcome: Outcome) =>
		kindOf(n).endReason(n, outcome);
	const endedAt = (outcome: string) => `Ended at node "n" with "${outcome}".`;

	test("pass is a chosen end and the plain end for an Agent, a Tool and a Value; fail and needs-input are not", () => {
		for (const n of [agent(), tool(), value("rule"), value("model")]) {
			expect(chosen(n, "pass")).toBe(true);
			expect(reason(n, "pass")).toBeNull();
			expect(chosen(n, "fail")).toBe(false);
			expect(chosen(n, "needs-input")).toBe(false);
		}
	});

	test("an Agent's own outcome is a chosen end with a reason", () => {
		const own = agent({ outcomes: [{ name: "shipped" }, { name: "fail" }] });
		expect(chosen(own, "shipped")).toBe(true);
		expect(reason(own, "shipped")).toBe(endedAt("shipped"));
		expect(chosen(own, "fail")).toBe(false);
		expect(chosen(own, "needs-input")).toBe(false);
		expect(chosen(agent(), "shipped")).toBe(false);
	});

	test("a Command's exit on code 0 is its chosen end, whatever its name; the others fail", () => {
		expect(chosen(command(), "pass")).toBe(true);
		expect(reason(command(), "pass")).toBeNull();
		expect(chosen(command(), "fail")).toBe(false);
		const exits = command({
			exits: [
				{ name: "clean", code: 0 },
				{ name: "dirty", code: 1 },
				{ name: "broken", code: null },
			],
		});
		expect(chosen(exits, "clean")).toBe(true);
		expect(reason(exits, "clean")).toBeNull();
		expect(chosen(exits, "dirty")).toBe(false);
		expect(chosen(exits, "broken")).toBe(false);
		expect(chosen(exits, "pass")).toBe(false);
	});

	test("every Decision option is a chosen end, with a reason unless it is named pass", () => {
		for (const by of ["person", "rule", "model"] as const) {
			expect(chosen(decision(by), "yes")).toBe(true);
			expect(reason(decision(by), "yes")).toBe(endedAt("yes"));
			expect(reason(decision(by), "pass")).toBeNull();
		}
	});

	test("a Wait that is done ends the flow plainly; a timeout is a failure", () => {
		const w = wait({ kind: "duration", minutes: 1 });
		expect(chosen(w, "done")).toBe(true);
		expect(reason(w, "done")).toBeNull();
		expect(chosen(w, "timeout")).toBe(false);
	});

	test("a Call once ends on pass; a Call with each ends on any outcome, done plainly", () => {
		expect(chosen(call(), "pass")).toBe(true);
		expect(reason(call(), "pass")).toBeNull();
		expect(chosen(call(), "fail")).toBe(false);
		expect(chosen(callEach(), "done")).toBe(true);
		expect(reason(callEach(), "done")).toBeNull();
		expect(chosen(callEach(), "halted")).toBe(true);
		expect(reason(callEach(), "halted")).toBe(endedAt("halted"));
		expect(reason(callEach(), "pass")).toBe(endedAt("pass"));
	});
});

describe("endedLabel: a Call's `ended` for the node its flow ended at", () => {
	test("a Decision option and an Agent's own outcome are the label; everything else is empty", () => {
		const own = agent({ outcomes: [{ name: "shipped" }] });
		expect(kindOf(decision("rule")).endedLabel(decision("rule"), "yes")).toBe(
			"yes",
		);
		expect(kindOf(own).endedLabel(own, "shipped")).toBe("shipped");
		expect(kindOf(own).endedLabel(own, "fail")).toBe("");
		expect(kindOf(agent()).endedLabel(agent(), "pass")).toBe("");
		for (const n of [
			command(),
			tool(),
			value("rule"),
			wait({ kind: "duration", minutes: 1 }),
			call(),
		]) {
			expect(kindOf(n).endedLabel(n, "pass")).toBe("");
		}
	});
});

describe("logsCommandOutput: which steps get a command log path", () => {
	test("a Command, a Call with a command source and a Wait that polls a command", () => {
		const logs = (n: FlowNode) => kindOf(n).logsCommandOutput(n);
		expect(logs(command())).toBe(true);
		expect(logs(callEach({ kind: "command", command: "ls" }))).toBe(true);
		expect(
			logs(wait({ kind: "command", command: "test -f x", everyMinutes: 1 })),
		).toBe(true);
		expect(logs(callEach({ kind: "json", path: "items" }))).toBe(false);
		expect(logs(call())).toBe(false);
		expect(logs(wait({ kind: "duration", minutes: 1 }))).toBe(false);
		for (const n of [agent(), tool(), decision("rule"), value("rule")]) {
			expect(logs(n)).toBe(false);
		}
	});
});

describe("timeBudget: the step's timers", () => {
	const budget = (n: FlowNode) => kindOf(n).timeBudget(n);

	test("an Agent has the step timer and the idle clock", () => {
		expect(budget(agent({ timeoutMinutes: 30, idleMinutes: 5 }))).toEqual({
			timeoutMinutes: 30,
			idleMinutes: 5,
		});
		expect(budget(agent())).toEqual({
			timeoutMinutes: undefined,
			idleMinutes: undefined,
		});
	});

	test("a Gate and a Wait node have no step timer; the other kinds have their own", () => {
		expect(budget(decision("person", { timeoutMinutes: 10 }))).toEqual({
			timeoutMinutes: undefined,
			idleMinutes: undefined,
		});
		expect(
			budget(wait({ kind: "duration", minutes: 1 }, { timeoutMinutes: 10 })),
		).toEqual({
			timeoutMinutes: undefined,
			idleMinutes: undefined,
		});
		for (const n of [
			command({ timeoutMinutes: 10 }),
			tool({ timeoutMinutes: 10 }),
			decision("rule", { timeoutMinutes: 10 }),
			decision("model", { timeoutMinutes: 10 }),
			value("model", { timeoutMinutes: 10 }),
			call({ timeoutMinutes: 10 }),
		]) {
			expect(budget(n)).toEqual({ timeoutMinutes: 10, idleMinutes: undefined });
		}
	});
});

describe("stoppedOutputs: what closeParked ends a parked step with", () => {
	const open = (fields: Partial<DerivedStep>): DerivedStep =>
		({
			id: "s1",
			nodeId: "n",
			visit: 2,
			outputs: { visit: 2, summary: "so far" },
			items: [],
			...fields,
		}) as DerivedStep;
	const item = (state: DerivedItem["state"]): DerivedItem =>
		({
			state,
			facts: { id: state },
			index: 1,
			open: false,
			branch: null,
		}) as DerivedItem;

	test("a Decision ends with an empty note", () => {
		const step = open({ nodeType: "decision" });
		expect(
			kindOfType("decision").stoppedOutputs(step, decision("person")),
		).toEqual({
			outcome: "stopped",
			note: "",
			visit: 2,
		});
	});

	test("a Call once ends with an empty label; a Call with each counts its items, also when the snapshot has no node", () => {
		const once = open({ nodeType: "call" });
		expect(kindOfType("call").stoppedOutputs(once, call())).toEqual({
			outcome: "stopped",
			ended: "",
			visit: 2,
		});
		const each = open({
			nodeType: "call",
			items: [item("done"), item("failed")],
		});
		const counted = kindOfType("call").stoppedOutputs(each, callEach());
		expect(counted).toMatchObject({
			outcome: "stopped",
			done_count: 1,
			failed_count: 1,
		});
		expect(kindOfType("call").stoppedOutputs(each, undefined)).toEqual(counted);
		expect(
			kindOfType("call").stoppedOutputs(open({ nodeType: "call" }), undefined),
		).toEqual({
			outcome: "stopped",
			ended: "",
			visit: 2,
		});
	});

	test("every other kind keeps the outputs it had, marked stopped", () => {
		for (const type of ["agent", "command", "tool", "value", "wait"] as const) {
			expect(
				kindOfType(type).stoppedOutputs(open({ nodeType: type }), undefined),
			).toEqual({
				visit: 2,
				summary: "so far",
				outcome: "stopped",
			});
		}
	});
});

describe("connections and requirements: what run start asks", () => {
	const has = (overrides: Partial<DaemonHas> = {}): DaemonHas => ({
		harnessFor: () => undefined,
		connectionNames: () => new Set(),
		cliNames: () => new Set(),
		findCli: () => null,
		decider: undefined,
		...overrides,
	});

	test("an Agent names its connections, a Tool its one; the other kinds none", () => {
		expect(
			kindOf(agent({ connections: ["jira", "github"] })).connections(
				agent({ connections: ["jira", "github"] }),
			),
		).toEqual(["jira", "github"]);
		expect(kindOf(agent()).connections(agent())).toEqual([]);
		expect(kindOf(tool()).connections(tool())).toEqual(["github"]);
		for (const n of [
			command(),
			decision("model"),
			value("model"),
			wait({ kind: "duration", minutes: 1 }),
			call(),
		]) {
			expect(kindOf(n).connections(n)).toEqual([]);
		}
	});

	test("the Agent kind requires its CLI tools, its harness and, for a checker, the decider", () => {
		const nodes = [
			agent({ harness: "codex", clis: ["gh"], checker: { prompt: "ok?" } }),
		];
		expect(NODE_KINDS.agent.requirements.map((r) => r(nodes, has()))).toEqual([
			'The flow uses the CLI tool "gh" (n), but no CLI tool has that name. Add it under Agents → Tools.',
			'The flow uses the CLI tool "gh", but this computer does not have it. Install gh, or take it off the flow.',
			"The flow has an Agent node on Codex (n), but no Codex harness is added. Add it under Agents.",
			"The flow has an Agent node with a checker, but no decider is configured.",
		]);
	});

	test("a model Decision and a model Value require the decider; by a rule or a person they require nothing", () => {
		expect(
			NODE_KINDS.decision.requirements.map((r) =>
				r([decision("model")], has()),
			),
		).toEqual([
			"The flow has a Decision node decided by a model, but no decider is configured.",
		]);
		expect(
			NODE_KINDS.decision.requirements.map((r) =>
				r([decision("person"), decision("rule")], has()),
			),
		).toEqual([null]);
		expect(
			NODE_KINDS.value.requirements.map((r) => r([value("model")], has())),
		).toEqual([
			"The flow has a Value node made by a model, but no decider is configured.",
		]);
		expect(
			NODE_KINDS.value.requirements.map((r) => r([value("rule")], has())),
		).toEqual([null]);
	});

	test("a Command, a Tool, a Wait and a Call require nothing of their own", () => {
		for (const type of ["command", "tool", "wait", "call"] as const) {
			expect(NODE_KINDS[type].requirements).toEqual([]);
		}
	});
});
