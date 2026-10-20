import { describe, expect, test } from "bun:test";
import {
	FLOW_VERSION,
	type Flow,
	flowSchema,
	setVariables,
} from "@nightshift/flows";

import { templateVariables } from "./flow-draft";

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
});
