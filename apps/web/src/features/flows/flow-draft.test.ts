import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "@nightshift/flows";

import {
	renameInput,
	renameVarInRule,
	renameVariable,
	renameVarRefs,
	setVariables,
	takenNames,
	templateVariables,
	withWrites,
} from "./flow-draft";

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
	test("the picker lists them after the inputs, with the type", () => {
		const groups = templateVariables(flow, "check");
		expect(groups.map((group) => group.scope)).toEqual([
			"inputs",
			"vars",
			"enough",
			"run",
		]);
		expect(groups[1]?.variables).toEqual([
			{
				text: "{{vars.tries}}",
				label: "tries",
				json: false,
				description: "number",
			},
			{
				text: "{{vars.plan}}",
				label: "plan",
				json: true,
				description: "json: The steps to take",
			},
		]);
	});

	test("a flow without variables has no vars group", () => {
		const groups = templateVariables(setVariables(flow, []), "check");
		expect(groups.map((group) => group.scope)).not.toContain("vars");
	});

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
