import { describe, expect, test } from "bun:test";
import { FLOW_VERSION, type Flow, flowSchema } from "@nightshift/flows";

import {
	completeTemplate,
	matchVariables,
	openTemplate,
	templateVariables,
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

describe("completing a template while you type", () => {
	const tries = {
		text: "{{vars.tries}}",
		label: "tries",
		json: false,
	};
	const plan = { text: "{{vars.plan}}", label: "plan", json: true };

	test("an open {{ before the cursor gives the name typed so far", () => {
		expect(openTemplate("Try {{vars.tr", 13)).toEqual({
			start: 4,
			query: "vars.tr",
		});
		expect(openTemplate("Try {{", 6)).toEqual({ start: 4, query: "" });
		expect(openTemplate("Try {{vars.tries}} now", 22)).toBeNull();
		expect(openTemplate("Try {vars", 9)).toBeNull();
	});

	test("only the variables that hold the name stay, in their groups", () => {
		const groups = templateVariables(flow, "check");
		const matches = matchVariables(groups, "TRI");
		expect(matches.map((group) => group.scope)).toEqual(["vars"]);
		expect(matches[0]?.variables.map((variable) => variable.text)).toEqual([
			"{{vars.tries}}",
		]);
		expect(matchVariables(groups, "")).toEqual(groups);
	});

	test("the variable takes the place of what you typed", () => {
		const text = "Try {{vars.tr and stop";
		const open = openTemplate(text, 13);
		if (!open) throw new Error("expected an open template");
		expect(completeTemplate(text, 13, open, tries)).toEqual({
			text: "Try {{vars.tries}} and stop",
			cursor: 18,
		});
	});

	test("a closing }} that is already there is not doubled", () => {
		const text = "Try {{va}} now";
		const open = openTemplate(text, 8);
		if (!open) throw new Error("expected an open template");
		expect(completeTemplate(text, 8, open, tries).text).toBe(
			"Try {{vars.tries}} now",
		);
	});

	test("a JSON value leaves the cursor before the closing braces", () => {
		const open = openTemplate("{{pl", 4);
		if (!open) throw new Error("expected an open template");
		expect(completeTemplate("{{pl", 4, open, plan)).toEqual({
			text: "{{vars.plan}}",
			cursor: 11,
		});
	});
});
