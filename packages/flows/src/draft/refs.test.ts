import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "../flow";
import { setVariables } from "./graph";
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
			output: "text",
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
		const [check, enough] = renamed.nodes;
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
		expect(renamed.outputs[0]?.value).toBe("{{vars.attempts}}");
	});

	test("renaming an input follows into initial values", () => {
		const renamed = renameInput(flow, 0, "from");
		expect(renamed.variables?.[0]?.initial).toBe("{{from}}");
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
