import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import { renameNode, setVariables } from "./graph";
import { takenNames } from "./names";
import { withWrites } from "./nodes";
import {
	renameInput,
	renameRefs,
	renameVarInRule,
	renameVariable,
	renameVarRefs,
} from "./refs";

const flow: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	inputs: [{ name: "start", type: "text" }],
	outputs: [{ name: "result", value: "{{vars.tries}}" }],
	variables: [
		{ name: "tries", type: "number", initial: "{{start}}" },
		{ name: "plan", type: "json", description: "The steps to take" },
	],
	start: "check",
	nodes: [
		{
			id: "check",
			type: "command",
			position: { x: 0, y: 0 },
			command: 'echo "{{vars.tries}} {{vars.tries_2}} {{ vars.plan.steps }}"',
			stdout: "text",
			set: [
				{ variable: "tries", expression: "vars.tries + 1" },
				{ variable: "plan", value: "{{vars.plan}}" },
			],
		},
		{
			id: "enough",
			type: "decision",
			position: { x: 0, y: 0 },
			prompt: "",
			by: "rule",
			options: [
				{ name: "stop", when: "vars.tries >= 3 and vars.tries_2 = 0" },
				{ name: "again" },
			],
		},
		{
			id: "moved",
			type: "since-last-run",
			position: { x: 0, y: 0 },
			value: "{{vars.tries}}",
			when: "current - previous > vars.tries",
		},
	],
	edges: [],
});

describe("variables in the draft", () => {
	test("renameVarRefs and renameVarInRule leave longer names alone", () => {
		expect(renameVarRefs("{{vars.tries}} {{vars.tries_2}}", "tries", "n")).toBe(
			"{{vars.n}} {{vars.tries_2}}",
		);
		expect(renameVarInRule("vars.tries + vars.tries_2", "tries", "n")).toBe(
			"vars.n + vars.tries_2",
		);
		expect(renameVarInRule("$x.vars.tries", "tries", "n")).toBe(
			"$x.vars.tries",
		);
	});

	test("renameVariable follows templates, rules, expressions, writes and outputs", () => {
		const renamed = renameVariable(flow, 0, "attempts");
		expect(renamed.variables?.map((v) => v.name)).toEqual(["attempts", "plan"]);
		const [check, enough, moved] = renamed.nodes;
		expect(check?.type === "command" && check.command).toBe(
			'echo "{{vars.attempts}} {{vars.tries_2}} {{ vars.plan.steps }}"',
		);
		expect(check?.set).toEqual([
			{ variable: "attempts", expression: "vars.attempts + 1" },
			{ variable: "plan", value: "{{vars.plan}}" },
		]);
		expect(enough?.type === "decision" && enough.options[0]?.when).toBe(
			"vars.attempts >= 3 and vars.tries_2 = 0",
		);
		expect(moved).toMatchObject({
			value: "{{vars.attempts}}",
			when: "current - previous > vars.attempts",
		});
		expect(renamed.outputs[0]?.value).toBe("{{vars.attempts}}");
	});

	test("renaming an input follows into initial values", () => {
		const renamed = renameInput(flow, 0, "from");
		expect(renamed.variables?.[0]?.initial).toBe("{{from}}");
	});

	test("renaming an input follows into the rules that read it", () => {
		const reads = flowSchema.parse({
			...flow,
			nodes: [
				{
					id: "enough",
					type: "decision",
					position: { x: 0, y: 0 },
					prompt: "",
					by: "rule",
					options: [{ name: "stop", when: 'start = "now"' }, { name: "go" }],
				},
			],
		});
		const [enough] = renameInput(reads, 0, "from").nodes;
		expect(enough?.type === "decision" && enough.options[0]?.when).toBe(
			'from = "now"',
		);
	});

	test("setVariables and withWrites drop empty lists from the file", () => {
		expect("variables" in setVariables(flow, [])).toBe(false);
		const node = flow.nodes[0];
		if (!node) throw new Error("no node");
		expect("set" in withWrites(node, [])).toBe(false);
	});

	test("variable names and vars are taken", () => {
		const taken = takenNames(flow);
		expect(taken.has("vars")).toBe(true);
		expect(taken.has("tries")).toBe(true);
	});
});

describe("renaming references", () => {
	test("renameRefs renames the name with any path and whitespace", () => {
		expect(renameRefs("{{a}} {{ a.b.c }} {{a.b-1}} {{\na\n}}", "a", "z")).toBe(
			"{{z}} {{ z.b.c }} {{z.b-1}} {{\nz\n}}",
		);
	});

	test("renameRefs leaves other names, paths and text alone", () => {
		const text = "{{ab}} {{a_2}} {{x.a}} {{ a .b }} {{A}} a {a} {{a.}}";
		expect(renameRefs(text, "a", "z")).toBe(text);
	});

	test("renameRefs finds a reference inside extra braces", () => {
		expect(renameRefs("{{{{a}}}} {{{a.b}}}", "a", "z")).toBe(
			"{{{{z}}}} {{{z.b}}}",
		);
	});

	test("renameVarRefs renames only the first key after vars", () => {
		expect(
			renameVarRefs(
				"{{ vars.a.x }} {{vars.a-b}} {{vars.b.a}} {{a}} {{vars}}",
				"a",
				"z",
			),
		).toBe("{{ vars.z.x }} {{vars.a-b}} {{vars.b.a}} {{a}} {{vars}}");
	});

	// A name outside the template grammar keeps the result of the old
	// pattern rewrite: the name goes into the pattern as it is. The editor
	// passes only valid names, so this does not happen there.
	test("a name outside the grammar keeps the old pattern rewrite", () => {
		expect(renameRefs("{{Foo}} {{Foo.bar}} {{foo}}", "Foo", "x")).toBe(
			"{{x}} {{x.bar}} {{foo}}",
		);
		expect(renameRefs("{{axb}}", "a.b", "c")).toBe("{{c}}");
		expect(renameVarRefs("{{vars.a b}} {{vars.a}}", "a b", "c")).toBe(
			"{{vars.c}} {{vars.a}}",
		);
		expect(renameVarRefs("{{vars.a.b}}", "a.b", "c")).toBe("{{vars.c}}");
	});
});

/** A node that reads `{{scout.data.topic}}` in one field, and the path to that field. */
type FieldCase = {
	field: string;
	node: Record<string, unknown>;
	path: (string | number)[];
};

const SCOUT = "{{scout.data.topic}}";
const personTier = (fields: Record<string, unknown>) => ({
	person: true,
	...fields,
});
const ask = (fields: Record<string, unknown>) => ({
	type: "value",
	by: "person",
	prompt: "",
	output: { type: "object", properties: { pick: { type: "string" } } },
	...fields,
});

/** Every field a template can sit in, one case each: the older node types and the new ones. */
const FIELD_CASES: FieldCase[] = [
	{
		field: "the check of an Agent",
		node: {
			type: "agent",
			prompt: "",
			cascade: [{ model: "small" }],
			check: `test -n "${SCOUT}"`,
		},
		path: ["check"],
	},
	{
		field: "the inputs of a Subflow's cascade tier",
		node: {
			type: "call",
			flow: "research",
			cascade: [{ flow: "deep", inputs: { topic: SCOUT } }],
		},
		path: ["cascade", 0, "inputs", "topic"],
	},
	{
		field: "the deadline of a cascade's person tier",
		node: {
			type: "agent",
			prompt: "",
			cascade: [
				{ model: "small" },
				personTier({ deadline: { at: SCOUT, choose: "stop" } }),
			],
		},
		path: ["cascade", 1, "deadline", "at"],
	},
	{
		field: "the situation of a cascade's person tier",
		node: {
			type: "call",
			flow: "research",
			cascade: [{}, personTier({ situation: SCOUT })],
		},
		path: ["cascade", 1, "situation"],
	},
	{
		field: "the recommendation of a cascade's person tier",
		node: {
			type: "decision",
			prompt: "",
			by: "model",
			options: [{ name: "go" }, { name: "stop" }],
			cascade: [
				{ model: "small" },
				personTier({ recommend: { option: "go", reason: SCOUT } }),
			],
		},
		path: ["cascade", 1, "recommend", "reason"],
	},
	{
		field: "the title of a Gate",
		node: {
			type: "decision",
			prompt: "",
			by: "person",
			title: SCOUT,
			options: [{ name: "go" }, { name: "stop" }],
		},
		path: ["title"],
	},
	{
		field: "the title of an Ask",
		node: ask({ title: SCOUT }),
		path: ["title"],
	},
	{
		field: "the choices of an Ask",
		node: ask({ choices: { from: SCOUT, field: "pick" } }),
		path: ["choices", "from"],
	},
	{
		field: "the file of an Ask's attachment",
		node: ask({ attachments: [{ path: `notes/${SCOUT}.md` }] }),
		path: ["attachments", 0, "path"],
	},
	{
		field: "the link of an Ask's attachment",
		node: ask({ attachments: [{ url: `https://example.com/${SCOUT}` }] }),
		path: ["attachments", 0, "url"],
	},
	{
		field: "the deadline of an Ask",
		node: ask({ deadline: { at: SCOUT }, default: { pick: "none" } }),
		path: ["deadline", "at"],
	},
	{
		field: "the key of a Wait for a signal",
		node: { type: "wait", until: { kind: "signal", name: "paid", key: SCOUT } },
		path: ["until", "key"],
	},
	{
		field: "the URL of a Web request",
		node: { type: "web-request", url: `https://example.com/${SCOUT}` },
		path: ["url"],
	},
	{
		field: "the URL secret of a Web request",
		node: { type: "web-request", urlSecret: SCOUT },
		path: ["urlSecret"],
	},
	{
		field: "a query value of a Web request",
		node: {
			type: "web-request",
			url: "https://example.com",
			query: { q: SCOUT },
		},
		path: ["query", "q"],
	},
	{
		field: "a header of a Web request",
		node: {
			type: "web-request",
			url: "https://example.com",
			headers: { "X-Topic": SCOUT },
		},
		path: ["headers", "X-Topic"],
	},
	{
		field: "the body of a Web request",
		node: {
			type: "web-request",
			method: "POST",
			url: "https://example.com",
			body: { kind: "json", value: SCOUT },
		},
		path: ["body", "value"],
	},
	{
		field: "a form field of a Web request",
		node: {
			type: "web-request",
			method: "POST",
			url: "https://example.com",
			body: { kind: "form", fields: { topic: SCOUT } },
		},
		path: ["body", "fields", "topic"],
	},
	{
		field: "the value of a Convert",
		node: { type: "convert", from: "csv", to: "json", value: SCOUT },
		path: ["value"],
	},
	{
		field: "the list of Since last run",
		node: { type: "since-last-run", items: SCOUT },
		path: ["items"],
	},
	{
		field: "the value of Since last run",
		node: { type: "since-last-run", value: SCOUT },
		path: ["value"],
	},
	{
		field: "the scope of Since last run",
		node: { type: "since-last-run", items: "[]", scope: SCOUT },
		path: ["scope"],
	},
	{
		field: "the report of an End",
		node: {
			type: "end",
			status: "done",
			report: { kind: "text", text: `## New\n\n${SCOUT}` },
		},
		path: ["report", "text"],
	},
];

function fieldAt(value: unknown, path: readonly (string | number)[]): unknown {
	let at = value;
	for (const key of path) {
		if (typeof at !== "object" || at === null) return undefined;
		at = (at as Record<string | number, unknown>)[key];
	}
	return at;
}

/** A flow of the node `scout` and a node that reads it. */
const scoutAndReader = (node: Record<string, unknown>, id = "scout"): Flow =>
	flowSchema.parse({
		version: FLOW_VERSION,
		inputs: [],
		outputs: [],
		variables: [{ name: "seen", type: "number" }],
		start: id,
		nodes: [
			{ id, type: "command", position: { x: 0, y: 0 }, command: "true" },
			{ id: "reader", position: { x: 0, y: 0 }, ...node },
		],
		edges: [],
	});

describe("renameNode follows every template", () => {
	test.each(FIELD_CASES)("$field", ({ node, path }) => {
		const flow = scoutAndReader(node);
		const before = fieldAt(flow.nodes[1], path);
		expect(typeof before === "string" && before.includes(SCOUT)).toBe(true);
		const renamed = renameNode(flow, "scout", "finder");
		expect(fieldAt(renamed.nodes[1], path)).toBe(
			String(before).replace(SCOUT, "{{finder.data.topic}}"),
		);
	});
});

/** A node whose rule reads `scout`, the path to the rule, and the rule after `scout` is `finder`. */
type RuleCase = FieldCase & { after: string };

const decideBy = (when: string) => ({
	type: "decision",
	prompt: "",
	by: "rule",
	options: [{ name: "go", when }, { name: "stop" }],
});

/** Every kind of rule that can read a node, one case each. */
const RULE_CASES: RuleCase[] = [
	{
		field: "the rule of a Decision option",
		node: decideBy('scout.data.count > 3 and scout.outcome = "pass"'),
		path: ["options", 0, "when"],
		after: 'finder.data.count > 3 and finder.outcome = "pass"',
	},
	{
		field: "the expression of a Value by rule",
		node: {
			type: "value",
			by: "rule",
			output: { type: "object" },
			expression:
				'{ "topic": scout.data.topic, "n": $count(scout.data.items) }',
		},
		path: ["expression"],
		after: '{ "topic": finder.data.topic, "n": $count(finder.data.items) }',
	},
	{
		field: "the rule of Since last run",
		node: {
			type: "since-last-run",
			value: "{{vars.seen}}",
			when: "current - previous > scout.data.limit",
		},
		path: ["when"],
		after: "current - previous > finder.data.limit",
	},
	{
		field: "the expression of a variable write",
		node: {
			type: "command",
			command: "true",
			set: [
				{
					variable: "seen",
					expression: "vars.seen + $count(scout.data.items)",
				},
			],
		},
		path: ["set", 0, "expression"],
		after: "vars.seen + $count(finder.data.items)",
	},
	{
		field: "a name in backticks",
		node: decideBy("`scout`.data.ok = true and (scout).data.ready"),
		path: ["options", 0, "when"],
		after: "`finder`.data.ok = true and (finder).data.ready",
	},
];

describe("renameNode follows every rule", () => {
	test.each(RULE_CASES)("$field", ({ node, path, after }) => {
		const renamed = renameNode(scoutAndReader(node), "scout", "finder");
		expect(fieldAt(renamed.nodes[1], path)).toBe(after);
	});

	test("the node's own write reads it under the new name", () => {
		const flow = flowSchema.parse({
			...scoutAndReader({ type: "command", command: "true" }),
			nodes: [
				{
					id: "scout",
					type: "command",
					position: { x: 0, y: 0 },
					command: "true",
					set: [{ variable: "seen", expression: "scout.data.count" }],
				},
			],
		});
		expect(renameNode(flow, "scout", "finder").nodes[0]?.set).toEqual([
			{ variable: "seen", expression: "finder.data.count" },
		]);
	});

	test("only the name the rule reads at the top changes, the rest of the text stays", () => {
		const rule =
			'scout.ok and "scout" = other.scout and other.tasks[scout = 1] and $scout and scout_2 /* scout */';
		const renamed = renameNode(
			scoutAndReader(decideBy(rule)),
			"scout",
			"finder",
		);
		expect(fieldAt(renamed.nodes[1], ["options", 0, "when"])).toBe(
			'finder.ok and "scout" = other.scout and other.tasks[scout = 1] and $scout and scout_2 /* scout */',
		);
	});

	test("a rule that is not valid stays as it is", () => {
		const renamed = renameNode(
			scoutAndReader(decideBy("scout.data = (")),
			"scout",
			"finder",
		);
		expect(fieldAt(renamed.nodes[1], ["options", 0, "when"])).toBe(
			"scout.data = (",
		);
	});

	// `previous` and `current`, `data` and `event` are the rule's own
	// values: a node of the same name is not what the rule reads.
	test.each([
		{
			field: "the values of Since last run",
			id: "previous",
			node: {
				type: "since-last-run",
				value: "{{vars.seen}}",
				when: "current - previous > 0",
			},
			path: ["when"],
		},
		{
			field: "the value a model made",
			id: "data",
			node: {
				type: "value",
				by: "model",
				prompt: "",
				output: { type: "object" },
				cascade: [{ model: "small", accept: "data.score > 0.5" }],
			},
			path: ["cascade", 0, "accept"],
		},
		{
			field: "the signal of a Wait",
			id: "event",
			node: {
				type: "wait",
				until: { kind: "signal", name: "paid" },
				outcomes: [{ name: "ok", when: "event.body.ok = true" }],
			},
			path: ["outcomes", 0, "when"],
		},
	])(
		"a node does not take the rule's own name: $field",
		({ id, node, path }) => {
			const flow = scoutAndReader(node, id);
			const renamed = renameNode(flow, id, "renamed");
			expect(fieldAt(renamed.nodes[1], path)).toBe(
				fieldAt(flow.nodes[1], path),
			);
		},
	);
});
