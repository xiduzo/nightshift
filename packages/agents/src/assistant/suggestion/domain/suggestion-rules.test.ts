import { describe, expect, test } from "bun:test";
import {
	FLOW_VERSION,
	type Flow,
	type FlowPlace,
	flowSchema,
	type SuggestionRequest,
	suggestionRequestSchema,
} from "@nightshift/flows";
import { dataReaders, scopeList } from "./flow-text";
import { suggestionPrompt } from "./suggestion-prompt";
import {
	cannotSuggest,
	checkSuggestion,
	suggestionDataSchema,
} from "./suggestion-rules";

const flow: Flow = flowSchema.parse({
	version: FLOW_VERSION,
	inputs: [{ name: "issue", type: "text", description: "The issue to fix" }],
	variables: [{ name: "tries", type: "number" }],
	start: "plan",
	nodes: [
		{
			id: "plan",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: { device: "mac", profile: "worker" },
			prompt: "Plan the fix for {{issue}}.",
		},
		{
			id: "build",
			type: "agent",
			position: { x: 300, y: 0 },
			profile: { device: "mac", profile: "worker" },
			prompt: "Build {{plan.data.steps}} on {{run.branch}}.",
		},
		{
			id: "gate",
			type: "decision",
			position: { x: 600, y: 0 },
			prompt: "Is it done?",
			by: "rule",
			options: [
				{ name: "yes", when: "plan.data.risky = false" },
				{ name: "no" },
			],
		},
	],
	edges: [
		{ id: "e1", from: "plan", outcome: "pass", to: "build" },
		{ id: "e2", from: "build", outcome: "pass", to: "gate" },
	],
});

function request(
	overrides: Partial<SuggestionRequest> = {},
): SuggestionRequest {
	return suggestionRequestSchema.parse({
		projectId: "p1",
		flowName: "fix",
		flow,
		nodeId: "plan",
		kind: "prompt",
		instruction: "Mention the issue and ask for a list of steps.",
		...overrides,
	});
}

describe("the suggestion prompts", () => {
	test("list what a template can read, from the editor's scope", () => {
		const list = scopeList(flow, "build");
		expect(list).toContain("`{{issue}}`: The issue to fix");
		expect(list).toContain("`{{vars.tries}}`");
		expect(list).toContain("`{{plan.data}}`");
		expect(list).toContain("`{{run.branch}}`");
	});

	test("find the data fields later nodes read, in templates and rules", () => {
		expect(dataReaders(flow, "plan")).toEqual([
			{ key: "steps", readers: ["node `build`"] },
			{ key: "risky", readers: ["node `gate`"] },
		]);
	});

	test("find what the flow reads, not what a label, a description or a field not in use says", () => {
		const reads = flowSchema.parse({
			...flow,
			outputs: [{ name: "plan", value: "{{plan.data.summary}}" }],
			nodes: [
				...flow.nodes.filter((node) => node.id !== "gate"),
				{
					id: "gate",
					type: "decision",
					position: { x: 600, y: 0 },
					label: "Reads plan.data.label",
					prompt: "",
					by: "rule",
					options: [
						{
							name: "yes",
							when: '$$.plan.data.risky = false and "plan.data.quoted" != ""',
							description: "When plan.data.description holds",
						},
						{ name: "no" },
					],
				},
				{
					id: "pick",
					type: "value",
					position: { x: 900, y: 0 },
					by: "model",
					prompt: "Pick from {{plan.data.choices}}.",
					output: { type: "object" },
					// A person picks from choices: a model does not use them.
					choices: { from: "{{plan.data.stale}}", field: "pick" },
				},
			],
		});
		expect(dataReaders(reads, "plan")).toEqual([
			{ key: "steps", readers: ["node `build`"] },
			{ key: "risky", readers: ["node `gate`"] },
			{ key: "choices", readers: ["node `pick`"] },
			{ key: "summary", readers: ["the flow's outputs"] },
		]);
	});

	test("the prompt kind marks the selection and keeps the instruction", () => {
		const text = suggestionPrompt(request({ selection: { start: 0, end: 8 } }));
		expect(text).toContain(
			"⟦SELECTION⟧Plan the⟦/SELECTION⟧ fix for {{issue}}.",
		);
		expect(text).toContain("Mention the issue and ask for a list of steps.");
		expect(text).toContain("# Writing Night Shift flows");
	});

	test("leave out what only the canvas needs: one field needs no layout", () => {
		// The guide's examples after the task have positions of their own.
		const full = suggestionPrompt(request());
		const prompt = full.slice(0, full.indexOf("# Your task"));
		expect(prompt).not.toContain('"position"');
		expect(prompt).not.toContain('"sections"');
	});

	test("the output kind names the fields later nodes read", () => {
		const text = suggestionPrompt(request({ kind: "output" }));
		expect(text).toContain("- `steps`: read by node `build`");
		expect(text).toContain("- `risky`: read by node `gate`");
	});

	test("the output kind of a command asks for the data it writes", () => {
		const withCommand = flowSchema.parse({
			...flow,
			nodes: [
				...flow.nodes,
				{
					id: "count",
					type: "command",
					position: { x: 0, y: 300 },
					command: "wc -l notes.md",
				},
			],
		});
		const text = suggestionPrompt(
			request({ flow: withCommand, nodeId: "count", kind: "output" }),
		);
		expect(text).toContain("the command writes to `$NS_OUTPUT`");
		expect(text).not.toContain("prompt asks the agent");
	});

	test("the set kind lists the node's outcomes", () => {
		const text = suggestionPrompt(request({ kind: "set" }));
		expect(text).toContain("`pass`, `fail`, `needs-input`");
	});
});

describe("checkSuggestion", () => {
	test("the data schema is the contract's, without kind and note", () => {
		const schema = suggestionDataSchema("set") as {
			properties: Record<string, unknown>;
		};
		expect(Object.keys(schema.properties).sort()).toEqual(["set", "variables"]);
		expect(suggestionDataSchema("prompt")).toMatchObject({
			type: "object",
			required: ["text"],
		});
	});

	test("a prompt with an unknown reference fails, with the validator's words", () => {
		const result = checkSuggestion(
			request(),
			{
				summary: "Uses the ticket.",
				data: { text: "Plan {{ticket}}." },
			},
			{},
		);
		expect("problems" in result && result.problems.join(" ")).toContain(
			"ticket",
		);
	});

	test("the answer is checked in the draft's place: a read of an output the called flow does not have fails", () => {
		const child = flowSchema.parse({
			version: FLOW_VERSION,
			outputs: [{ name: "summary", value: "{{notes.output}}" }],
			start: "notes",
			nodes: [
				{
					id: "notes",
					type: "command",
					position: { x: 0, y: 0 },
					command: "cat notes.md",
				},
			],
			edges: [],
		});
		const calling = flowSchema.parse({
			...flow,
			start: "sub",
			nodes: [
				{
					id: "sub",
					type: "call",
					position: { x: 0, y: 0 },
					flow: "child",
					inputs: {},
				},
				{ ...flow.nodes[0], prompt: "Plan the fix." },
			],
			edges: [{ id: "e1", from: "sub", outcome: "pass", to: "plan" }],
		});
		const report = { summary: "x", data: { text: "Plan {{sub.sumary}}." } };
		const checked = (place: FlowPlace) =>
			checkSuggestion(request({ flow: calling }), report, place);
		// While the project's flows are not known, a Call's outputs are not either.
		expect("suggestion" in checked({})).toBe(true);
		const result = checked({ flows: { child }, name: "fix" });
		expect("problems" in result && result.problems.join(" ")).toContain(
			'"sub" has no field "sumary"',
		);
	});

	test("a valid prompt passes with the summary as its note", () => {
		expect(
			checkSuggestion(
				request(),
				{
					summary: "Asks for steps.",
					data: { text: "Plan {{issue}}. List the steps." },
				},
				{},
			),
		).toEqual({
			suggestion: {
				kind: "prompt",
				text: "Plan {{issue}}. List the steps.",
				note: "Asks for steps.",
			},
		});
	});

	test("an output that is not an object schema fails", () => {
		const result = checkSuggestion(
			request({ kind: "output" }),
			{
				summary: "x",
				data: { output: { type: "string" } },
			},
			{},
		);
		expect("problems" in result).toBe(true);
	});

	test("set: a write to an undeclared variable fails unless the variable comes along", () => {
		const bad = checkSuggestion(
			request({ kind: "set" }),
			{
				summary: "x",
				data: { set: [{ variable: "plan_text", value: "{{plan.output}}" }] },
			},
			{},
		);
		expect("problems" in bad).toBe(true);
		const good = checkSuggestion(
			request({ kind: "set" }),
			{
				summary: "x",
				data: {
					set: [
						{ variable: "plan_text", value: "{{plan.output}}" },
						{ variable: "tries", expression: "vars.tries + 1" },
					],
					variables: [
						{ name: "plan_text", type: "text" },
						// Declared already: left out.
						{ name: "tries", type: "number" },
					],
				},
			},
			{},
		);
		expect(good).toMatchObject({
			suggestion: { variables: [{ name: "plan_text", type: "text" }] },
		});
	});

	test("a node without the field cannot get a suggestion", () => {
		expect(cannotSuggest(request({ nodeId: "gate", kind: "output" }))).toBe(
			"A Decision node has no output data to suggest.",
		);
		expect(cannotSuggest(request({ nodeId: "nope" }))).toContain("no step");
	});
});
