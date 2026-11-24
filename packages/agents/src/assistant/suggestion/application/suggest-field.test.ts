import { describe, expect, test } from "bun:test";
import {
	FLOW_VERSION,
	type Flow,
	flowSchema,
	type SuggestionEvent,
	type SuggestionRequest,
	suggestionRequestSchema,
} from "@nightshift/flows";
import type { AssistantVia } from "../../sessions";
import { inMemorySessions } from "../../sessions/adapters/out/in-memory-sessions";
import { inMemoryProjectFactsReader } from "../adapters/out/in-memory-project-facts-reader";
import { suggestionPrompt } from "../domain/suggestion-prompt";
import { suggestionDataSchema } from "../domain/suggestion-rules";
import { suggestField } from "./suggest-field";

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
			id: "check",
			type: "command",
			position: { x: 0, y: 300 },
			command: "npm test",
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

type Script = Parameters<typeof inMemorySessions>[0];

const usage = { inputTokens: 100, outputTokens: 10, costUsd: 0.01 };

/** A session that reports `data`. */
const reporting = (data: unknown, sessionId = "s-1"): Script => [
	{ type: "session", sessionId },
	{ type: "activity", text: "Reads package.json" },
	{ type: "usage", usage },
	{ type: "end", sessionId, report: { summary: "A note.", data }, text: "" },
];

const agent: AssistantVia = {
	kind: "agent",
	harness: {
		name: "codex",
		label: "Codex",
		run: async function* () {},
		takeOverCommand: () => null,
	},
	profile: { model: "m" },
	cwd: "/repo",
};
const model: AssistantVia = {
	kind: "model",
	ask: async () => ({ kind: "made", data: null, costUsd: null }),
};
const facts = {
	packageManager: "bun",
	scripts: { test: "bun test" },
	taskFiles: [],
};

async function suggest(
	scripts: Script[],
	over: { request?: SuggestionRequest; via?: AssistantVia } = {},
) {
	const sessions = inMemorySessions(...scripts);
	const readProjectFacts = inMemoryProjectFactsReader({ "/repo": facts });
	const events: SuggestionEvent[] = [];
	for await (const event of suggestField({
		...sessions,
		readProjectFacts,
	})({
		request: over.request ?? request(),
		via: over.via ?? agent,
		place: {},
		signal: new AbortController().signal,
	})) {
		events.push(event);
	}
	return { events, asked: sessions.asked, read: readProjectFacts.read };
}

const good = { text: "Plan {{issue}}." };
const bad = { text: "Plan {{ticket}}." };

describe("suggestField", () => {
	test("streams what the agent does, then the suggestion", async () => {
		const { events, asked, read } = await suggest([reporting(good)]);
		expect(events).toEqual([
			{ type: "activity", text: "Reads package.json" },
			{ type: "usage", usage },
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
		expect(asked).toHaveLength(1);
		expect(asked[0]?.prompt).toBe(suggestionPrompt(request(), null));
		expect(asked[0]?.report).toEqual({
			output: suggestionDataSchema("prompt"),
		});
		expect(asked[0]?.resumeSessionId).toBeUndefined();
		expect(read).toEqual([]);
	});

	test("a command of an agent starts from the facts of the project, one of a model does not", async () => {
		const command = request({ nodeId: "check", kind: "command" });
		const answer = [reporting({ command: "bun test" })];
		const one = await suggest(answer, { request: command });
		expect(one.read).toEqual(["/repo"]);
		expect(one.asked[0]?.prompt).toContain("Package manager: bun");
		const two = await suggest(answer, { request: command, via: model });
		expect(two.read).toEqual([]);
		expect(two.asked[0]?.prompt).not.toContain("Package manager: bun");
	});

	test("sends an invalid answer back once in the same session, with its problems", async () => {
		const { events, asked } = await suggest([reporting(bad), reporting(good)]);
		expect(asked).toHaveLength(2);
		expect(asked[1]?.resumeSessionId).toBe("s-1");
		expect(asked[1]?.prompt).toStartWith("Your suggestion does not pass");
		expect(asked[1]?.prompt).toContain("ticket");
		// The usage adds up over both answers.
		expect(events.filter((e) => e.type === "usage").at(-1)).toEqual({
			type: "usage",
			usage: { inputTokens: 200, outputTokens: 20, costUsd: 0.02 },
		});
		expect(events.at(-1)).toEqual({ type: "done" });
	});

	test("without a session to resume, the problems follow the whole prompt", async () => {
		const ended = (data: unknown): Script => [
			{
				type: "end",
				sessionId: "",
				report: { summary: "A note.", data },
				text: "",
			},
		];
		const { asked } = await suggest([ended(bad), ended(good)], { via: model });
		expect(asked[1]?.resumeSessionId).toBeUndefined();
		expect(asked[1]?.prompt).toStartWith(`${asked[0]?.prompt}\n\nYour`);
	});

	test("gives up after the second invalid answer, with the problem", async () => {
		const { events, asked } = await suggest([reporting(bad)]);
		expect(asked).toHaveLength(2);
		const last = events.at(-1);
		expect(last?.type === "error" && last.message).toContain("ticket");
	});

	test("a session that ends without a report is asked again", async () => {
		const { events, asked } = await suggest([
			[{ type: "end", sessionId: "s-1", report: null, text: "Hm." }],
			reporting(good),
		]);
		expect(asked[1]?.prompt).toContain("without a report");
		expect(events.at(-1)).toEqual({ type: "done" });
	});

	test("a failure, or a session that stops early, ends the stream with an error", async () => {
		const failed = await suggest([
			[{ type: "error", message: "No network.", sessionId: "s-1" }],
		]);
		expect(failed.events).toEqual([{ type: "error", message: "No network." }]);
		expect(failed.asked).toHaveLength(1);
		const early = await suggest([[{ type: "session", sessionId: "s-1" }]]);
		expect(early.events).toEqual([
			{ type: "error", message: "The agent stopped without an answer." },
		]);
	});

	test("a field that takes no suggestion is refused before anything runs", async () => {
		const { events, asked } = await suggest([], {
			request: request({ nodeId: "gate", kind: "output" }),
		});
		expect(events).toEqual([
			{
				type: "error",
				message: "A Decision node has no output data to suggest.",
			},
		]);
		expect(asked).toEqual([]);
	});
});
