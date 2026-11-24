import { describe, expect, test } from "bun:test";
import { builtinAgent, FLOW_VERSION, flowSchema } from "@nightshift/flows";
import type { AuthoringPort } from "../domain/authoring";
import type { HistoryPort } from "../domain/history-port";
import { inMemorySessions } from "../sessions/adapters/out/in-memory-sessions";
import {
	type ChatTurnEvent,
	type ChatTurnInput,
	chatTurn,
	type TurnTools,
} from "./chat-turn";

const flow = flowSchema.parse({
	version: FLOW_VERSION,
	start: "build",
	nodes: [
		{
			id: "build",
			type: "command",
			position: { x: 0, y: 0 },
			command: "bun run build",
		},
	],
	edges: [],
});

const port: Omit<AuthoringPort, "propose"> = {
	draft: async () => ({ name: "fix", flow }),
	flows: async () => ({}),
	profiles: async () => [],
	tools: async () => ({ clis: [], connections: [] }),
	skills: async () => [],
	place: async () => ({}),
};
const past: HistoryPort = {
	flowName: "fix",
	runs: async () => [],
	run: async () => null,
	transcript: async () => null,
	spend: async () => ({}),
	revisions: async () => null,
	revision: async () => null,
};
const harness = {
	name: "codex" as const,
	label: "Codex",
	run: async function* () {},
	takeOverCommand: () => null,
};
const proposal = { flow, summary: "Adds a step.", issues: [] };

async function turn(
	over: Partial<ChatTurnInput> = {},
	script: Parameters<typeof inMemorySessions>[0] = [
		{ type: "end", sessionId: "s-1", report: null, text: "" },
	],
	propose = 0,
) {
	const sessions = inMemorySessions(script);
	const given: TurnTools[] = [];
	const events: ChatTurnEvent[] = [];
	for await (const event of chatTurn({
		...sessions,
		toolsFor: (input) => {
			given.push(input);
			for (let i = 0; i < propose; i++) input.proposals.push(proposal);
			return [{ name: "get_draft", description: "" }] as never;
		},
		describeTool: () => "Reads your flow",
	})({
		agent: "improver",
		request: {
			projectId: "p1",
			flowName: "fix",
			flow,
			message: "Run the tests.",
		},
		harness,
		profile: { model: "m" },
		cwd: "/repo",
		port,
		signal: new AbortController().signal,
		...over,
	})) {
		events.push(event);
	}
	const asked = sessions.sessions[0];
	if (!asked) throw new Error("No session was asked");
	return { events, asked, given: given[0] };
}

const about = {
	projectId: "p1",
	flowName: "fix",
	flow,
	message: "Why?",
	runId: "r1",
};

describe("chatTurn", () => {
	test("a first message: the chat prompt with the flow, the tools and the agent's limits", async () => {
		const { asked } = await turn();
		expect(asked.prompt).toContain('# The flow "fix"');
		expect(asked.prompt).toContain(
			"Steps: `build` (command). Starts at `build`.",
		);
		expect(asked.prompt).toContain("Run the tests.");
		expect(asked.prompt).toContain("# Writing Night Shift flows");
		expect(asked.resumeSessionId).toBeUndefined();
		expect(asked.tools?.map((tool) => tool.name)).toEqual(["get_draft"]);
		expect(asked.describeTool?.("get_draft", {})).toBe("Reads your flow");
		const limits = builtinAgent("improver").limits;
		expect(asked.limits).toBe(limits);
		expect(builtinAgent("builder").limits).not.toBe(limits);
		expect((await turn({ agent: "builder" })).asked.limits).toBe(
			builtinAgent("builder").limits,
		);
	});

	test("streams the answer, each proposal before what follows it, then done", async () => {
		const { events } = await turn(
			{},
			[
				{ type: "session", sessionId: "s-1" },
				{ type: "activity", text: "Reads your flow" },
				{ type: "text", delta: "Done." },
				{ type: "usage", usage: { inputTokens: 1, outputTokens: 1 } },
				{ type: "end", sessionId: "s-1", report: null, text: "Done." },
			],
			2,
		);
		expect(events).toEqual([
			{ type: "proposal", proposal },
			{ type: "proposal", proposal },
			{ type: "session", sessionId: "s-1" },
			{ type: "activity", text: "Reads your flow" },
			{ type: "text", delta: "Done." },
			{ type: "usage", usage: { inputTokens: 1, outputTokens: 1 } },
			{ type: "done" },
		]);
	});

	test("a failed session ends with its error, and keeps the proposals", async () => {
		const { events } = await turn(
			{},
			[{ type: "error", message: "Stopped.", sessionId: "s-1" }],
			1,
		);
		expect(events).toEqual([
			{ type: "proposal", proposal },
			{ type: "error", message: "Stopped." },
		]);
	});

	test("a later message resumes the session with the message alone", async () => {
		const { asked } = await turn({
			resumeSessionId: "s-0",
			request: about,
		});
		expect(asked.resumeSessionId).toBe("s-0");
		expect(asked.prompt).toStartWith("The person's next message.");
		expect(asked.prompt).toEndWith("Why?");
		expect(asked.prompt).not.toContain("# Writing Night Shift flows");
		expect(asked.prompt).not.toContain("This chat is about run");
		const fresh = await turn({
			resumeSessionId: "s-0",
			newRun: true,
			request: about,
		});
		expect(fresh.asked.prompt).toContain("This chat is about run r1");
	});

	test("only the Improver is told of the run and the history, and gets its tools", async () => {
		const improver = await turn({ past, request: about });
		expect(improver.asked.prompt).toContain("get_spend");
		expect(improver.asked.prompt).toContain("This chat is about run r1");
		expect(improver.given?.past).toBe(past);
		const builder = await turn({ agent: "builder", past, request: about });
		expect(builder.asked.prompt).not.toContain("get_spend");
		expect(builder.asked.prompt).not.toContain("This chat is about run r1");
		expect(builder.given?.past).toBeUndefined();
	});

	test("a new session of a chat on another agent gets the chat so far", async () => {
		const { asked } = await turn({
			history: [{ message: "What is missing?", answer: "A lint step." }],
		});
		expect(asked.prompt).toContain("# The chat so far");
		expect(asked.prompt).toContain("A lint step.");
		expect(asked.prompt.indexOf("What is missing?")).toBeLessThan(
			asked.prompt.indexOf("Run the tests."),
		);
	});
});
