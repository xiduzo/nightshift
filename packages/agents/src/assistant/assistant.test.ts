import { describe, expect, test } from "bun:test";
import {
	type Flow,
	flowSchema,
	type SuggestionEvent,
	type SuggestionRequest,
	suggestionRequestSchema,
} from "@nightshift/flows";
import { type FakeScript, fakeHarness } from "../testing/fake";
import { activityOf, bareToolName } from "./activity";
import { dataReaders, scopeList } from "./prompts";
import {
	type AssistantSessionEvent,
	runAssistantSession,
	sessionErrorMessage,
	settleUsage,
} from "./session";
import {
	cannotSuggest,
	checkSuggestion,
	suggestField,
	suggestionDataSchema,
} from "./suggest";
import { suggestionPrompt } from "./suggestion-prompt";

const flow: Flow = flowSchema.parse({
	version: 7,
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

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const event of stream) out.push(event);
	return out;
}

const profile = { model: "fake-model" };

describe("activityOf", () => {
	test("plain words for each harness's read tools, never a tool name", () => {
		const cwd = "/repo";
		expect(activityOf("Read", { file_path: "/repo/package.json" }, cwd)).toBe(
			"Reads package.json",
		);
		expect(activityOf("read", { filePath: "src/a.ts" }, cwd)).toBe(
			"Reads src/a.ts",
		);
		expect(activityOf("Grep", { pattern: "TODO" }, cwd)).toBe(
			'Searches for "TODO"',
		);
		expect(activityOf("Glob", { pattern: "**/*.md" }, cwd)).toBe(
			"Looks for files like **/*.md",
		);
		expect(activityOf("ls", {}, cwd)).toBe("Lists the project folder");
		expect(activityOf("mcp__tanstack__report_step", {}, cwd)).toBe(
			"Writes the answer",
		);
		expect(activityOf("tanstack_report_step", {}, cwd)).toBe(
			"Writes the answer",
		);
		expect(activityOf("TodoWrite", {}, cwd)).toBeNull();
		expect(activityOf("mystery_tool", {}, cwd)).toBe(
			"Looks through the project",
		);
	});

	test("Night Shift's own tools are named by the caller", () => {
		expect(
			activityOf("mcp__tanstack__get_draft", {}, "/", (name) =>
				name === "get_draft" ? "Reads the flow" : undefined,
			),
		).toBe("Reads the flow");
		expect(bareToolName("mcp__my_server__do_it")).toBe("do_it");
	});
});

describe("runAssistantSession", () => {
	test("maps the harness's events and runs read only", async () => {
		const harness = fakeHarness({
			steps: [
				{ type: "text", text: "Looking." },
				{ type: "tool", name: "Read", input: { file_path: "/repo/AGENTS.md" } },
				{ type: "tool", name: "Read", input: { file_path: "/repo/AGENTS.md" } },
				{ type: "text", text: "Done." },
				{ type: "report", outcome: "", summary: "Ok.", data: { a: 1 } },
			],
			outcome: {
				type: "finished",
				usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.5 },
			},
		});
		const events = await collect(
			runAssistantSession({
				harness,
				profile: { model: "m", effort: "low" },
				cwd: "/repo",
				prompt: "Hi",
				report: { output: { type: "object" } },
				signal: new AbortController().signal,
			}),
		);
		const call = harness.calls[0];
		expect(call?.readOnly).toBe(true);
		expect(call?.permissionMode).toBe("default");
		expect(call?.effort).toBe("low");
		expect(call?.stepReport).toEqual({
			outcome: false,
			output: { type: "object" },
		});
		const types = events.map((e) => e.type);
		expect(types[0]).toBe("session");
		// The same line twice in a row shows once.
		expect(events.filter((e) => e.type === "activity")).toEqual([
			{ type: "activity", text: "Reads AGENTS.md" },
		]);
		const end = events.at(-1) as Extract<
			AssistantSessionEvent,
			{ type: "end" }
		>;
		expect(end.type).toBe("end");
		expect(end.text).toBe("Looking.\n\nDone.");
		expect(end.report).toEqual({ summary: "Ok.", data: { a: 1 } });
		expect(events).toContainEqual({
			type: "usage",
			usage: { inputTokens: 10, outputTokens: 2, costUsd: 0.5 },
		});
	});

	test("the end usage never counts less than the running total before it", async () => {
		// The harness's end usage covers only the last model call.
		const harness = fakeHarness({
			steps: [
				{
					type: "usage",
					usage: { inputTokens: 900, outputTokens: 90, costUsd: 0.035 },
				},
			],
			outcome: {
				type: "finished",
				usage: { inputTokens: 200, outputTokens: 20, costUsd: 0.007 },
			},
		});
		const events = await collect(
			runAssistantSession({
				harness,
				profile,
				cwd: "/",
				prompt: "Hi",
				signal: new AbortController().signal,
			}),
		);
		expect(events.filter((e) => e.type === "usage").at(-1)).toEqual({
			type: "usage",
			usage: { inputTokens: 900, outputTokens: 90, costUsd: 0.035 },
		});
	});

	test("an end usage that covers the running total wins with its reported cost", () => {
		const live = { inputTokens: 900, outputTokens: 90, costUsd: 0.035 };
		const end = { inputTokens: 900, outputTokens: 95, costUsd: 0.007 };
		expect(settleUsage(live, end)).toEqual(end);
		expect(settleUsage(null, end)).toEqual(end);
		expect(settleUsage(live, { inputTokens: 100, outputTokens: 99 })).toEqual({
			inputTokens: 900,
			outputTokens: 99,
			costUsd: 0.035,
		});
	});

	test("a failure ends with words for the person and the session to resume", async () => {
		const harness = fakeHarness({
			outcome: { type: "error", kind: "usage-limit", message: "429" },
		});
		const events = await collect(
			runAssistantSession({
				harness,
				profile,
				cwd: "/",
				prompt: "Hi",
				signal: new AbortController().signal,
			}),
		);
		expect(events.at(-1)).toEqual({
			type: "error",
			message: sessionErrorMessage("usage-limit", "429"),
			sessionId: "fake-session-1",
		});
	});

	test("resumes the session it is given", async () => {
		const harness = fakeHarness({});
		await collect(
			runAssistantSession({
				harness,
				profile,
				cwd: "/",
				prompt: "More",
				resumeSessionId: "s-1",
				signal: new AbortController().signal,
			}),
		);
		expect(harness.calls[0]?.resumeSessionId).toBe("s-1");
	});
});

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
		const result = checkSuggestion(request(), {
			summary: "Uses the ticket.",
			data: { text: "Plan {{ticket}}." },
		});
		expect("problems" in result && result.problems.join(" ")).toContain(
			"ticket",
		);
	});

	test("a valid prompt passes with the summary as its note", () => {
		expect(
			checkSuggestion(request(), {
				summary: "Asks for steps.",
				data: { text: "Plan {{issue}}. List the steps." },
			}),
		).toEqual({
			suggestion: {
				kind: "prompt",
				text: "Plan {{issue}}. List the steps.",
				note: "Asks for steps.",
			},
		});
	});

	test("an output that is not an object schema fails", () => {
		const result = checkSuggestion(request({ kind: "output" }), {
			summary: "x",
			data: { output: { type: "string" } },
		});
		expect("problems" in result).toBe(true);
	});

	test("set: a write to an undeclared variable fails unless the variable comes along", () => {
		const bad = checkSuggestion(request({ kind: "set" }), {
			summary: "x",
			data: { set: [{ variable: "plan_text", value: "{{plan.output}}" }] },
		});
		expect("problems" in bad).toBe(true);
		const good = checkSuggestion(request({ kind: "set" }), {
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
		});
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

describe("suggestField", () => {
	const reporting = (data: unknown): FakeScript => ({
		steps: [
			{ type: "tool", name: "Read", input: { file_path: "package.json" } },
			{ type: "report", outcome: "", summary: "A note.", data },
		],
		outcome: {
			type: "finished",
			usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.01 },
		},
	});

	test("streams what the agent does, then the suggestion", async () => {
		const harness = fakeHarness(reporting({ text: "Plan {{issue}}." }));
		const events = await collect(
			suggestField({
				request: request(),
				harness,
				profile,
				cwd: "/repo",
				signal: new AbortController().signal,
			}),
		);
		expect(events).toEqual<SuggestionEvent[]>([
			{ type: "activity", text: "Reads package.json" },
			{
				type: "usage",
				usage: { inputTokens: 100, outputTokens: 10, costUsd: 0.01 },
			},
			{
				type: "suggestion",
				suggestion: {
					kind: "prompt",
					text: "Plan {{issue}}.",
					note: "A note.",
				},
			},
			{ type: "done" },
		]);
		expect(harness.calls[0]?.prompt).toContain("Suggest a prompt");
		expect(harness.calls[0]?.stepReport).toMatchObject({ outcome: false });
	});

	test("sends an invalid answer back once in the same session, with its problems", async () => {
		const harness = fakeHarness((_input, call) =>
			reporting({ text: call === 0 ? "Plan {{ticket}}." : "Plan {{issue}}." }),
		);
		const events = await collect(
			suggestField({
				request: request(),
				harness,
				profile,
				cwd: "/repo",
				signal: new AbortController().signal,
			}),
		);
		expect(harness.calls).toHaveLength(2);
		expect(harness.calls[1]?.resumeSessionId).toBe("fake-session-1");
		expect(harness.calls[1]?.prompt).toContain("does not pass the checks");
		expect(harness.calls[1]?.prompt).toContain("ticket");
		// The usage adds up over both answers.
		expect(events.filter((e) => e.type === "usage").at(-1)).toEqual({
			type: "usage",
			usage: { inputTokens: 200, outputTokens: 20, costUsd: 0.02 },
		});
		expect(events.at(-1)).toEqual({ type: "done" });
	});

	test("gives up after the second invalid answer", async () => {
		const harness = fakeHarness(reporting({ text: "Plan {{ticket}}." }));
		const events = await collect(
			suggestField({
				request: request(),
				harness,
				profile,
				cwd: "/repo",
				signal: new AbortController().signal,
			}),
		);
		expect(harness.calls).toHaveLength(2);
		const last = events.at(-1);
		expect(last?.type).toBe("error");
	});

	test("a session that ends without a report is asked again", async () => {
		const harness = fakeHarness((_input, call) =>
			call === 0 ? {} : reporting({ text: "Plan {{issue}}." }),
		);
		const events = await collect(
			suggestField({
				request: request(),
				harness,
				profile,
				cwd: "/repo",
				signal: new AbortController().signal,
			}),
		);
		expect(harness.calls[1]?.prompt).toContain("without a report");
		expect(events.at(-1)).toEqual({ type: "done" });
	});

	test("a harness failure ends the stream with an error", async () => {
		const harness = fakeHarness({
			outcome: { type: "error", kind: "network", message: "ECONNRESET" },
		});
		const events = await collect(
			suggestField({
				request: request(),
				harness,
				profile,
				cwd: "/repo",
				signal: new AbortController().signal,
			}),
		);
		expect(events.at(-1)).toEqual({
			type: "error",
			message: sessionErrorMessage("network", "ECONNRESET"),
		});
		expect(harness.calls).toHaveLength(1);
	});
});
