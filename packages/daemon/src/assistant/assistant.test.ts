import { describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { appRouter } from "@nightshift/api";
import type { Context } from "@nightshift/api/context";
import { accessAs, testContext } from "@nightshift/api/testing";
import type {
	ProfileStore,
	SettingsStore,
} from "@nightshift/engine/device-config";
import type {
	AgentHarnessName,
	AgentProfileSettings,
	BuiltinAnswers,
	ChatEvent,
	ChatRequest,
	ExplanationEvent,
	SuggestionEvent,
	SuggestionRequest,
} from "@nightshift/flows";
import { FLOW_VERSION, flowSchema } from "@nightshift/flows";
import type { FlowInput } from "@nightshift/flows/testing";
import { call } from "@orpc/server";
import {
	type AssistantDeps,
	BUSY,
	createAssistant,
	NO_CHAT_PROFILE,
	NO_CHECK_MODEL,
	NO_CLONE,
	NO_MODEL_HERE,
	NO_PROFILE,
	NOT_ENDED_EARLY,
	pickAgent,
} from "./assistant";
import { authoringPort, chatRun, historyPort } from "./authoring";

const settingsOf = (
	harness: AgentHarnessName,
	model = "m",
): AgentProfileSettings => ({
	harness,
	model,
	permissionMode: "acceptEdits",
	clis: [],
	connections: [],
});

function profiles(
	list: Record<string, AgentProfileSettings>,
): Pick<ProfileStore, "list"> {
	return {
		list: () =>
			Object.entries(list).map(([name, settings]) => ({
				...settings,
				id: name,
				name,
				updatedAt: 0,
			})),
	};
}

const settings = (
	assistantProfile = "",
	builtinAgents: BuiltinAnswers = {},
): Pick<SettingsStore, "current"> => ({
	current: () =>
		({ assistantProfile, builtinAgents }) as ReturnType<
			SettingsStore["current"]
		>,
});

function deps(over: Partial<AssistantDeps> = {}): AssistantDeps {
	const harness = fakeHarness();
	return {
		profiles: profiles({
			a_codex: settingsOf("codex"),
			b_claude: settingsOf("claude-code", "sonnet"),
		}),
		settings: settings(),
		harnessFor: (name) => (name === "claude-code" ? harness : undefined),
		installed: (name) => name === "claude-code",
		clonePath: async () => "/repo",
		space: () => ({
			flows: {
				map: async () => ({ fix: null }),
				revisions: async () => [],
				revision: async () => {
					throw new Error("No such revision");
				},
			},
			listRuns: async () => [],
			getRun: async () => {
				throw new Error("No such run");
			},
			stepTranscript: async () => ({ entries: [], holds: "whole" }),
			listDevices: async () => [],
		}),
		cliTools: { list: () => [] },
		connections: { list: () => [] },
		skills: async () => [],
		...over,
	};
}

describe("pickAgent", () => {
	test("the request's profile first", () => {
		expect(pickAgent({ profile: "a_codex" }, deps())).toMatchObject({
			profile: "a_codex",
		});
		expect(pickAgent({ profile: "gone" }, deps())).toEqual({
			error:
				'There is no profile "gone" on this computer. Pick another one, or add it on the Agents page.',
		});
	});

	test("the request's own fields override its profile, as on an Agent node", () => {
		expect(
			pickAgent({ profile: "b_claude", model: "haiku", effort: "low" }, deps()),
		).toEqual({
			profile: "b_claude",
			settings: { harness: "claude-code", model: "haiku", effort: "low" },
		});
	});

	test("no profile: the request's own harness and model", () => {
		expect(
			pickAgent({ harness: "claude-code", model: "haiku" }, deps()),
		).toEqual({
			profile: null,
			settings: { harness: "claude-code", model: "haiku" },
		});
		expect(pickAgent({ model: "haiku" }, deps())).toEqual({
			error: "Choose a profile, or a harness and a model.",
		});
	});

	test("then the setting, then the first profile whose harness is here", () => {
		expect(
			pickAgent({}, deps({ settings: settings("a_codex") })),
		).toMatchObject({ profile: "a_codex" });
		// A profile in the settings that is gone falls back.
		expect(pickAgent({}, deps({ settings: settings("gone") }))).toMatchObject({
			profile: "b_claude",
			settings: { model: "sonnet" },
		});
		expect(pickAgent({}, deps())).toMatchObject({ profile: "b_claude" });
	});

	test("none: tells the person to add one", () => {
		expect(pickAgent({}, deps({ installed: () => false }))).toEqual({
			error: NO_PROFILE,
		});
	});

	test("a built-in agent: the agent the person chose for it in Settings", () => {
		const chosen = settings("", {
			builder: { kind: "agent", profile: "a_codex" },
			explainer: { kind: "agent", harness: "claude-code", model: "haiku" },
		});
		expect(
			pickAgent({}, deps({ settings: chosen }), { builtin: "builder" }),
		).toMatchObject({ profile: "a_codex" });
		expect(
			pickAgent({}, deps({ settings: chosen }), { builtin: "explainer" }),
		).toEqual({
			profile: null,
			settings: { harness: "claude-code", model: "haiku" },
		});
		// An agent with no choice follows the computer.
		expect(
			pickAgent({}, deps({ settings: chosen }), { builtin: "improver" }),
		).toMatchObject({ profile: "b_claude" });
		// The request's own pick still wins.
		expect(
			pickAgent({ profile: "b_claude" }, deps({ settings: chosen }), {
				builtin: "builder",
			}),
		).toMatchObject({ profile: "b_claude" });
	});

	test("a chosen agent that is gone falls back to the first that works", () => {
		const chosen = settings("", {
			builder: { kind: "agent", profile: "gone" },
		});
		expect(
			pickAgent({}, deps({ settings: chosen }), { builtin: "builder" }),
		).toMatchObject({ profile: "b_claude" });
	});
});

const flow: FlowInput = {
	version: FLOW_VERSION,
	inputs: [{ name: "issue", type: "text" }],
	start: "plan",
	nodes: [
		{
			id: "plan",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: { device: "mac", profile: "worker" },
			prompt: "Plan {{issue}}.",
		},
	],
	edges: [],
};

/** The owner of this computer, signed in. */
function context(assistant: Context["assistant"]): Context {
	return testContext({
		access: accessAs({ personId: "owner", spaceId: "space", role: "owner" }),
		daemon: { device: { id: "d", name: "test", ownerId: "owner" } },
		assistant,
	});
}

async function suggest(
	assistant: Context["assistant"],
	over: Partial<SuggestionRequest> = {},
): Promise<SuggestionEvent[]> {
	const stream = await call(
		appRouter.assistant.suggest,
		{
			projectId: "p1",
			flowName: "fix",
			flow,
			nodeId: "plan",
			kind: "prompt",
			instruction: "Ask for steps.",
			...over,
		},
		{ context: context(assistant), path: ["assistant", "suggest"] },
	);
	const events: SuggestionEvent[] = [];
	for await (const event of stream) events.push(event as SuggestionEvent);
	return events;
}

describe("assistant.suggest", () => {
	test("streams a suggestion made on the chosen profile, read only in the Clone", async () => {
		const harness = fakeHarness({
			steps: [
				{ type: "tool", name: "Read", input: { file_path: "/repo/AGENTS.md" } },
				{
					type: "report",
					outcome: "",
					summary: "Asks for a list of steps.",
					data: { text: "Plan {{issue}}. List the steps." },
				},
			],
		});
		const events = await suggest(
			createAssistant(deps({ harnessFor: () => harness })),
		);
		expect(events.map((e) => e.type)).toEqual([
			"activity",
			"usage",
			"suggestion",
			"done",
		]);
		expect(events[0]).toEqual({ type: "activity", text: "Reads AGENTS.md" });
		expect(events[2]).toEqual({
			type: "suggestion",
			suggestion: {
				kind: "prompt",
				text: "Plan {{issue}}. List the steps.",
				note: "Asks for a list of steps.",
			},
		});
		const input = harness.calls[0];
		expect(input?.cwd).toBe("/repo");
		expect(input?.model).toBe("sonnet");
		expect(input?.readOnly).toBe(true);
	});

	test("runs on the harness, model and effort the person picks", async () => {
		const harness = fakeHarness({
			steps: [
				{
					type: "report",
					outcome: "",
					summary: "Shorter.",
					data: { text: "Plan {{issue}}." },
				},
			],
		});
		const events = await suggest(
			createAssistant(deps({ harnessFor: () => harness })),
			{ harness: "claude-code", model: "haiku", effort: "low" },
		);
		expect(events.at(-1)).toEqual({ type: "done" });
		expect(harness.calls[0]?.model).toBe("haiku");
		expect(harness.calls[0]?.effort).toBe("low");
		expect(harness.calls[0]?.readOnly).toBe(true);
		expect(harness.calls[0]?.permissionMode).toBe("default");
	});

	test("checks the answer in the draft's place, as the person sees the Space", async () => {
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
		const calling: FlowInput = {
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
				...flow.nodes,
			],
			edges: [{ id: "e1", from: "sub", outcome: "pass", to: "plan" }],
		};
		const harness = fakeHarness({
			steps: [
				{
					type: "report",
					outcome: "",
					summary: "Uses the notes.",
					data: { text: "Plan {{sub.sumary}}." },
				},
			],
		});
		const base = deps({ harnessFor: () => harness });
		const scopes: unknown[] = [];
		const events = await suggest(
			createAssistant({
				...base,
				space: (scope) => {
					scopes.push(scope);
					return {
						...base.space(scope),
						flows: {
							...base.space(scope).flows,
							map: async () => ({ fix: null, child }),
						},
					};
				},
			}),
			{ flow: flowSchema.parse(calling) },
		);
		// Sent back once, then given up: the called flow has no such output.
		expect(harness.calls).toHaveLength(2);
		expect(events.at(-1)).toMatchObject({
			type: "error",
			message: expect.stringContaining('"sub" has no field "sumary"'),
		});
		expect(scopes).toEqual([{ spaceId: "space", personId: "owner" }]);
	});

	test("for a project without a folder, works in the assistant's own folder (ADR 22)", async () => {
		const harness = fakeHarness({
			steps: [
				{
					type: "report",
					outcome: "",
					summary: "Shorter.",
					data: { text: "Plan {{issue}}." },
				},
			],
		});
		const noFolder = {
			clonePath: async () => null,
			withoutFolder: async (projectId: string) => projectId === "p1",
			ownFolder: async () => "/data/assistant",
			harnessFor: () => harness,
		};
		expect((await suggest(createAssistant(deps(noFolder)))).at(-1)).toEqual({
			type: "done",
		});
		expect(harness.calls[0]?.cwd).toBe("/data/assistant");
		// A project with a folder that is not here stays not here.
		expect(
			await suggest(createAssistant(deps(noFolder)), { projectId: "p2" }),
		).toEqual([{ type: "error", message: NO_CLONE }]);
	});

	test("ends with an error the person can act on", async () => {
		expect(
			await suggest(createAssistant(deps({ clonePath: async () => null }))),
		).toEqual([{ type: "error", message: NO_CLONE }]);
		expect(
			await suggest(createAssistant(deps({ installed: () => false }))),
		).toEqual([{ type: "error", message: NO_PROFILE }]);
		expect(
			await suggest(createAssistant(deps()), { harness: "codex", model: "m" }),
		).toEqual([
			{
				type: "error",
				message:
					"The Codex harness is not added on this computer. Add it on the Agents page, or choose another harness.",
			},
		]);
		expect(
			await suggest(createAssistant(deps({ installed: () => false })), {
				harness: "claude-code",
				model: "haiku",
			}),
		).toEqual([
			{
				type: "error",
				message:
					"Night Shift cannot find Claude Code on this computer. Install it, or choose another harness.",
			},
		]);
	});

	test("a harness without a model is not a valid request", async () => {
		await expect(
			suggest(createAssistant(deps()), { harness: "claude-code" }),
		).rejects.toThrow();
	});
});

/** The draft with a test step after `plan`. */
const withTests = {
	...flow,
	nodes: [
		...flow.nodes,
		{
			id: "test",
			type: "command",
			position: { x: 300, y: 0 },
			command: "bun test",
		},
	],
	edges: [{ id: "plan-pass-test", from: "plan", outcome: "pass", to: "test" }],
};

async function chat(
	assistant: Context["assistant"],
	over: Partial<ChatRequest> = {},
): Promise<ChatEvent[]> {
	const stream = await call(
		appRouter.assistant.chat,
		{
			projectId: "p1",
			flowName: "fix",
			flow,
			message: "Run the tests after the plan.",
			...over,
		},
		{ context: context(assistant), path: ["assistant", "chat"] },
	);
	const events: ChatEvent[] = [];
	for await (const event of stream) events.push(event as ChatEvent);
	return events;
}

describe("assistant.chat", () => {
	test("streams the thread, the agent's work and a proposal, read only in the Clone", async () => {
		const harness = fakeHarness({
			steps: [
				{ type: "tool", name: "get_draft" },
				{
					type: "tool",
					name: "propose_flow",
					input: { flow: withTests, summary: "Runs the tests after the plan." },
				},
				{ type: "text", text: "I added a test step." },
			],
		});
		const events = await chat(
			createAssistant(deps({ harnessFor: () => harness })),
		);
		expect(events[0]?.type).toBe("thread");
		expect(events.filter((e) => e.type === "activity")).toEqual([
			{ type: "activity", text: "Reads your flow" },
			{ type: "activity", text: "Proposes a new version of the flow" },
		]);
		const proposal = events.find((e) => e.type === "proposal");
		expect(proposal).toMatchObject({
			type: "proposal",
			proposal: { summary: "Runs the tests after the plan.", issues: [] },
		});
		if (proposal?.type === "proposal") {
			expect(proposal.proposal.flow.nodes.map((n) => n.id)).toEqual([
				"plan",
				"test",
			]);
		}
		expect(events.map((e) => (e.type === "text" ? e.delta : "")).join("")).toBe(
			"I added a test step.",
		);
		expect(events.at(-1)).toEqual({ type: "done" });
		const input = harness.calls[0];
		expect(input?.cwd).toBe("/repo");
		expect(input?.readOnly).toBe(true);
		expect(input?.tools?.map((t) => t.name)).toContain("propose_flow");
	});

	test("for a project without a folder, chats in the assistant's own folder (ADR 22)", async () => {
		const harness = fakeHarness({
			steps: [{ type: "text", text: "Done." }],
		});
		const events = await chat(
			createAssistant(
				deps({
					clonePath: async () => null,
					withoutFolder: async () => true,
					ownFolder: async () => "/data/assistant",
					harnessFor: () => harness,
				}),
			),
		);
		expect(events.at(-1)).toEqual({ type: "done" });
		expect(harness.calls[0]?.cwd).toBe("/data/assistant");
	});

	test("a proposal is checked in the draft's place: the project's folder and the Space's Devices", async () => {
		const publish = {
			...withTests,
			nodes: [
				// A profile on a Device whose profiles this computer cannot tell.
				{ ...flow.nodes[0], profile: { device: "studio", profile: "night" } },
				withTests.nodes[1],
				{
					id: "publish",
					type: "call",
					position: { x: 600, y: 0 },
					flow: "kit:github/publish-draft-pr",
					inputs: { title: "Notes" },
				},
			],
			edges: [
				...withTests.edges,
				{ id: "e2", from: "test", outcome: "pass", to: "publish" },
			],
		};
		const harness = fakeHarness({
			steps: [
				{
					type: "tool",
					name: "propose_flow",
					input: { flow: publish, summary: "Publishes the notes." },
				},
			],
		});
		const base = deps();
		const events = await chat(
			createAssistant({
				...base,
				space: (scope) => ({
					...base.space(scope),
					listDevices: async () =>
						[{ deviceId: "studio", name: "Studio" }] as never,
				}),
				clonePath: async () => null,
				withoutFolder: async () => true,
				ownFolder: async () => "/data/assistant",
				harnessFor: () => harness,
			}),
		);
		const proposal = events.find((e) => e.type === "proposal");
		expect(proposal?.type === "proposal" && proposal.proposal.issues).toEqual([
			{
				severity: "warning",
				message: expect.stringContaining("This project has no folder"),
				nodeId: "publish",
			},
		]);
	});

	test("a later message on the thread resumes its session; an unknown thread starts anew", async () => {
		const harness = fakeHarness({ steps: [{ type: "text", text: "Ok." }] });
		const assistant = createAssistant(deps({ harnessFor: () => harness }));
		const first = await chat(assistant);
		const threadId = first[0]?.type === "thread" ? first[0].threadId : "";
		expect(threadId).not.toBe("");
		const second = await chat(assistant, { threadId, message: "And lint?" });
		expect(second[0]).toEqual({ type: "thread", threadId });
		expect(harness.calls[0]?.resumeSessionId).toBeUndefined();
		expect(harness.calls[1]?.resumeSessionId).toBe("fake-session-1");
		expect(harness.calls[1]?.prompt).toContain("And lint?");
		// Another flow, or a thread this computer does not keep: a new one.
		const other = await chat(assistant, { threadId, flowName: "release" });
		expect(other[0]).not.toEqual({ type: "thread", threadId });
		expect(harness.calls[2]?.resumeSessionId).toBeUndefined();
		const gone = await chat(assistant, { threadId: "gone" });
		expect(gone[0]?.type).toBe("thread");
		expect(harness.calls[3]?.resumeSessionId).toBeUndefined();
	});

	test("a chat about a run: told once, while every message names the run", async () => {
		const harness = fakeHarness({ steps: [{ type: "text", text: "Ok." }] });
		const assistant = createAssistant(deps({ harnessFor: () => harness }));
		const first = await chat(assistant, { runId: "r1" });
		const threadId = first[0]?.type === "thread" ? first[0].threadId : "";
		await chat(assistant, { threadId, runId: "r1", message: "Fix it." });
		expect(harness.calls[0]?.prompt).toContain("This chat is about run r1");
		expect(harness.calls[0]?.tools?.map((t) => t.name)).toContain("get_run");
		expect(harness.calls[1]?.prompt).not.toContain("This chat is about run");
		expect(harness.calls[1]?.tools?.map((t) => t.name)).toContain("get_run");
	});

	test("one message at a time per thread", async () => {
		const harness = fakeHarness({
			steps: [
				{ type: "wait", ms: 200 },
				{ type: "text", text: "Ok." },
			],
		});
		const assistant = createAssistant(deps({ harnessFor: () => harness }));
		const first = await chat(assistant);
		const threadId = first[0]?.type === "thread" ? first[0].threadId : "";
		const [a, b] = await Promise.all([
			chat(assistant, { threadId }),
			Bun.sleep(50).then(() => chat(assistant, { threadId })),
		]);
		expect(a.at(-1)).toEqual({ type: "done" });
		expect(b).toEqual([{ type: "error", message: BUSY }]);
	});

	test("another model on a harness that resumes with it: the same session", async () => {
		const harness = fakeHarness({ steps: [{ type: "text", text: "Ok." }] });
		const assistant = createAssistant(deps({ harnessFor: () => harness }));
		const first = await chat(assistant, { profile: "b_claude" });
		const threadId = first[0]?.type === "thread" ? first[0].threadId : "";
		await chat(assistant, {
			threadId,
			message: "And lint?",
			harness: "claude-code",
			model: "haiku",
			effort: "low",
		});
		expect(harness.calls[1]?.resumeSessionId).toBe("fake-session-1");
		expect(harness.calls[1]?.model).toBe("haiku");
		expect(harness.calls[1]?.effort).toBe("low");
	});

	test("another harness: a new session with the chat so far, on the same thread", async () => {
		const claude = fakeHarness({
			steps: [{ type: "text", text: "Add a lint step." }],
		});
		const goose = fakeHarness({ steps: [{ type: "text", text: "Done." }] });
		const assistant = createAssistant(
			deps({
				harnessFor: (name) => (name === "acp:goose" ? goose : claude),
				installed: () => true,
			}),
		);
		const first = await chat(assistant, { message: "What is missing?" });
		const threadId = first[0]?.type === "thread" ? first[0].threadId : "";
		const second = await chat(assistant, {
			threadId,
			message: "Then add it.",
			harness: "acp:goose",
			model: "default",
		});
		expect(second[0]).toEqual({ type: "thread", threadId });
		expect(second.at(-1)).toEqual({ type: "done" });
		const input = goose.calls[0];
		expect(input?.resumeSessionId).toBeUndefined();
		expect(input?.readOnly).toBe(true);
		expect(input?.prompt).toContain("# The chat so far");
		expect(input?.prompt).toContain("What is missing?");
		expect(input?.prompt).toContain("Add a lint step.");
		expect(input?.prompt).toContain("Then add it.");
		// The next message on goose resumes goose's session.
		await chat(assistant, {
			threadId,
			message: "Thanks.",
			harness: "acp:goose",
			model: "default",
		});
		expect(goose.calls[1]?.resumeSessionId).toBe("fake-session-1");
	});

	test("another model on a harness that cannot resume with it: a new session with the chat so far", async () => {
		const goose = fakeHarness({ steps: [{ type: "text", text: "Ok." }] });
		const assistant = createAssistant(
			deps({ harnessFor: () => goose, installed: () => true }),
		);
		const agent = { harness: "acp:goose", model: "a" } as const;
		const first = await chat(assistant, { ...agent, message: "Hello." });
		const threadId = first[0]?.type === "thread" ? first[0].threadId : "";
		await chat(assistant, { ...agent, threadId, message: "Again." });
		expect(goose.calls[1]?.resumeSessionId).toBe("fake-session-1");
		await chat(assistant, { ...agent, model: "b", threadId, message: "Now." });
		expect(goose.calls[2]?.resumeSessionId).toBeUndefined();
		expect(goose.calls[2]?.model).toBe("b");
		expect(goose.calls[2]?.prompt).toContain("Hello.");
		expect(goose.calls[2]?.prompt).toContain("Again.");
	});

	test("a harness the person picks that cannot use the chat's tools: says which to choose", async () => {
		const assistant = createAssistant(
			deps({ harnessFor: () => fakeHarness(), installed: () => true }),
		);
		expect(await chat(assistant, { harness: "pi", model: "m" })).toEqual([
			{
				type: "error",
				message:
					"The chat cannot use pi. It cannot read your flow or propose changes. Choose Claude Code, Codex or OpenCode in Settings.",
			},
		]);
	});

	test("a profile whose agent cannot use the chat's tools: says which to choose", async () => {
		const harness = fakeHarness();
		const assistant = createAssistant(
			deps({
				profiles: profiles({
					local: settingsOf("pi"),
					b_claude: settingsOf("claude-code", "sonnet"),
				}),
				settings: settings("local"),
				harnessFor: () => harness,
				installed: () => true,
			}),
		);
		const refused = await chat(assistant, { profile: "local" });
		expect(refused).toHaveLength(1);
		expect(refused[0]?.type === "error" && refused[0].message).toContain(
			"Choose an agent in Settings that uses Claude Code, Codex or OpenCode.",
		);
		// The profile for help does not fit the chat: the first that does.
		const events = await chat(assistant);
		expect(events.at(-1)).toEqual({ type: "done" });
		expect(harness.calls.at(-1)?.model).toBe("sonnet");
	});
});

describe("chatRun", () => {
	const run = {
		id: "r1",
		projectId: "p1",
		status: "failed",
		reason: "The step `test` failed.",
		inputs: { issue: "#1" },
		flow: withTests,
		steps: [
			{
				id: "s1",
				nodeId: "plan",
				nodeType: "agent",
				visit: 1,
				outcome: "pass",
				error: null,
				outputs: { summary: "Planned." },
			},
			{
				id: "s2",
				nodeId: "test",
				nodeType: "command",
				visit: 1,
				outcome: "fail",
				error: null,
				outputs: {},
			},
		],
	};
	const detail = (over: object = {}) => ({ ...run, ...over }) as never;
	const entry = (seq: number, event: unknown) =>
		({ seq, stepId: "s2", sessionId: null, at: seq, event }) as never;
	/** A Space whose step `s2` saved a long command, and what each read asked. */
	const space = (holds: "whole" | "so-far" | "cut" = "whole") => {
		const asked: string[] = [];
		return {
			asked,
			stepTranscript: async (runId: string, stepId: string) => {
				asked.push(`${runId}/${stepId}`);
				return {
					entries: [
						entry(1, { type: "command-start", command: "bun test" }),
						...Array.from({ length: 1000 }, (_, i) =>
							entry(2 + i, {
								type: "command-output",
								stream: "stdout",
								text: `line ${i}\n`,
							}),
						),
						entry(2000, { type: "command-exit", exitCode: 1 }),
					],
					holds,
				};
			},
		};
	};
	const signal = new AbortController().signal;

	test("the failed step and the end of its saved transcript, bounded", async () => {
		const saved = space();
		const found = await chatRun(saved, detail(), signal);
		expect(saved.asked).toEqual(["r1/s2"]);
		expect(found.failedStepId).toBe("s2");
		expect(found.steps[0]?.note).toBe("Planned.");
		expect(found.transcript.at(-1)).toBe("Exit code: 1");
		expect(found.transcript).toContain("line 999");
		expect(found.transcript).not.toContain("$ bun test");
		expect(found.transcript.length).toBeLessThanOrEqual(300);
		expect(found).not.toHaveProperty("transcriptHolds");
	});

	test("a step that still runs, or a read that stopped, says so", async () => {
		const running = await chatRun(space("so-far"), detail(), signal);
		expect(running.transcriptHolds).toBe("so-far");
		expect(running.transcript.at(-1)).toBe("Exit code: 1");
		const cut = await chatRun(space("cut"), detail(), signal);
		expect(cut.transcriptHolds).toBe("cut");
		// A read that fails keeps nothing, and says so.
		const failed = await chatRun(
			{
				stepTranscript: async () => {
					throw new Error("The Host is away.");
				},
			},
			detail(),
			signal,
		);
		expect(failed.transcript).toEqual([]);
		expect(failed.transcriptHolds).toBe("cut");
	});

	test("a run that failed nowhere reads no transcript", async () => {
		const saved = space();
		const found = await chatRun(
			saved,
			detail({ status: "finished", steps: [run.steps[0]] }),
			signal,
		);
		expect(found.failedStepId).toBeNull();
		expect(found.transcript).toEqual([]);
		expect(saved.asked).toEqual([]);
	});

	test("a failure inside a called flow: that step, with the flow it ran in", async () => {
		const nested = detail({
			flow: {
				...withTests,
				nodes: [{ id: "each_task", type: "call", flow: "build-task" }],
			},
			calledFlows: {
				"build-task": { nodes: [{ id: "check", type: "command" }] },
			},
			steps: [
				{
					...run.steps[0],
					id: "c1",
					nodeId: "each_task",
					nodeType: "call",
					outcome: "fail",
					scope: null,
				},
				{
					...run.steps[1],
					id: "c2",
					nodeId: "check",
					scope: { parentStepId: "c1", itemId: null },
				},
			],
		});
		const found = await chatRun(space(), nested, signal);
		expect(found.failedStepId).toBe("c2");
		expect(found.steps.map((s) => s.flow)).toEqual([null, "build-task"]);
	});

	test("the editor's get_run: a run of another project, or none, is null", async () => {
		const port = (projectId: string, runId: string) =>
			authoringPort(
				{
					space: {
						...deps().space({ spaceId: "s", personId: "p" }),
						getRun: async (id: string) => {
							if (id !== "r1") throw new Error("No such run");
							return detail();
						},
					},
					profiles: { list: () => [] },
					cliTools: { list: () => [] },
					connections: { list: () => [] },
					skills: async () => [],
				},
				{ projectId, runId, flowName: "fix", flow: withTests } as never,
				signal,
			);
		expect(await port("p2", "r1").run?.()).toBeNull();
		expect(await port("p1", "nope").run?.()).toBeNull();
		expect((await port("p1", "r1").run?.())?.failedStepId).toBe("s2");
	});

	test("the history tools read only the chat's project", async () => {
		const costs = {
			costUsd: 3,
			costEstimated: false,
			costMissing: 0,
			costCalls: 2,
		};
		const summary = (id: string, flowName: string, createdAt: number) => ({
			...costs,
			id,
			projectId: "p1",
			flowName,
			title: flowName,
			status: "finished",
			result: "done",
			reason: null,
			trigger: { kind: "schedule" },
			createdAt,
			endedAt: createdAt + 60_000,
		});
		const revision = (id: string, at: number, current = false) => ({
			id,
			at,
			kind: "save" as const,
			person: { id: "u1", name: "Ada" },
			device: { id: "d1", name: "Studio" },
			current,
			changes: null,
		});
		const asked: unknown[] = [];
		const port = (projectId: string) =>
			historyPort(
				{
					...space(),
					getRun: async (id: string) => {
						if (id !== "r1") throw new Error("No such run");
						return detail({
							...costs,
							flowName: "fix",
							flowRevision: "v2",
							createdAt: 1_000,
							endedAt: 61_000,
							steps: run.steps.map((step, index) => ({
								...step,
								scope: null,
								startedAt: 1_000,
								endedAt: 31_000,
								sessions: index === 0 ? [{}, {}] : [],
								...costs,
								costUsd: index === 0 ? 3 : 0,
								costCalls: index === 0 ? 2 : 0,
							})),
						});
					},
					listRuns: async (input) => {
						asked.push(input);
						return [
							summary("r1", "fix", 1_000),
							summary("r2", "other", 2_000),
							summary("r3", "fix", 3_000),
						] as never;
					},
					flows: {
						map: async () => ({ fix: null }),
						revisions: async () => [
							revision("v2", 20, true),
							revision("v1", 10),
						],
						revision: async (_project, _flow, id, against) =>
							({
								revision: { ...revision(id, 20), flow: withTests },
								against: { revisionId: against ?? null, flow: null },
								diff: null,
							}) as never,
					},
				},
				{ projectId, runId: "r1", flowName: "fix", flow: withTests } as never,
				signal,
			);
		const own = port("p1");
		// A run of another project is no run, for every read.
		expect(await port("p2").run("r1")).toBeNull();
		expect(await port("p2").transcript("r1", "s2")).toBeNull();

		const runs = await own.runs({ flow: "fix", limit: 10 });
		expect(runs.map((each) => each.id)).toEqual(["r3", "r1"]);
		expect(runs[0]).toMatchObject({ startedBy: "schedule", cost: { usd: 3 } });
		expect(asked).toEqual([{ projectId: "p1" }]);

		const found = await own.run("r1");
		expect(found).toMatchObject({ revisionId: "v2", cost: { usd: 3 } });
		expect(found?.steps[0]).toMatchObject({
			nodeId: "plan",
			usd: 3,
			ms: 30_000,
			sessions: 2,
		});

		// A step by its id, or by its node for the last visit.
		expect((await own.transcript("r1", "test"))?.nodeId).toBe("test");
		expect(await own.transcript("r1", "nope")).toBeNull();

		expect(await own.revisions("nope")).toBeNull();
		expect((await own.revisions("fix"))?.[0]).toMatchObject({
			id: "v2",
			by: "Ada",
			current: true,
		});
		// Compared with the revision before it, and the first with none.
		expect((await own.revision("fix", "v2"))?.against).toBe("v1");
		expect((await own.revision("fix", "v1"))?.against).toBeNull();
		expect(await own.revision("fix", "v9")).toBeNull();
	});

	test("a test run says so, and so does each step that stood in", async () => {
		const tested = detail({
			status: "finished",
			test: { pinned: ["plan"], skipped: [] },
			steps: [{ ...run.steps[0], test: "pinned" }],
		});
		const found = await chatRun(space(), tested, signal);
		expect(found.test).toEqual({ pinned: ["plan"], skipped: [] });
		expect(found.steps.map((step) => step.test)).toEqual(["pinned"]);
		// A run that is no test says nothing of it.
		const real = await chatRun(
			space(),
			detail({ steps: [run.steps[0]] }),
			signal,
		);
		expect(real).not.toHaveProperty("test");
		expect(real.steps[0]).not.toHaveProperty("test");
	});
});

describe("assistant.explain", () => {
	const failed = {
		id: "r1",
		projectId: "p1",
		status: "failed",
		reason: "The step `test` failed.",
		inputs: {},
		flow: flowSchema.parse(withTests),
		steps: [
			{
				id: "s2",
				nodeId: "test",
				nodeType: "command",
				visit: 1,
				outcome: "fail",
				error: null,
				outputs: {},
			},
		],
	};
	const runSpace = (run: typeof failed) => () => ({
		flows: {
			map: async () => ({}),
			revisions: async () => [],
			revision: async () => {
				throw new Error("No such revision");
			},
		},
		listRuns: async () => [],
		getRun: async (id: string) => {
			if (id !== run.id) throw new Error("No such run");
			return run as never;
		},
		stepTranscript: async () => ({
			entries: [
				{
					seq: 1,
					stepId: "s2",
					sessionId: null,
					at: 1,
					event: { type: "command-exit", exitCode: 1 },
				} as never,
			],
			holds: "whole" as const,
		}),
		listDevices: async () => [],
	});

	/** A Person who does not own this computer, with `role` in the run's Space. */
	function asked(role: "member" | "viewer", assistant: Context["assistant"]) {
		return testContext({
			access: accessAs({ personId: "ann", spaceId: "space", role }),
			daemon: { device: { id: "d", name: "test", ownerId: "owner" } },
			engine: { spaceOfRun: async () => "space" },
			assistant,
		});
	}

	async function explain(context: Context): Promise<ExplanationEvent[]> {
		const stream = await call(
			appRouter.assistant.explain,
			{ runId: "r1" },
			{ context, path: ["assistant", "explain"] },
		);
		const events: ExplanationEvent[] = [];
		for await (const event of stream) events.push(event as ExplanationEvent);
		return events;
	}

	test("a Member who does not own this computer gets one answer, read only in the Clone", async () => {
		const harness = fakeHarness({
			steps: [
				{
					type: "report",
					outcome: "",
					summary: "The **tests** failed. Try the run again.",
				},
			],
		});
		const events = await explain(
			asked(
				"member",
				createAssistant(
					deps({ harnessFor: () => harness, space: runSpace(failed) }),
				),
			),
		);
		expect(events.filter((e) => e.type !== "usage")).toEqual([
			{ type: "activity", text: "Reads the run" },
			{ type: "answer", answer: "The tests failed. Try the run again." },
			{ type: "done" },
		]);
		const input = harness.calls[0];
		expect(input?.cwd).toBe("/repo");
		expect(input?.readOnly).toBe(true);
		expect(input?.tools).toBeUndefined();
		expect(input?.prompt).toContain("Status: failed");
		expect(input?.prompt).toContain("Exit code: 1");
		expect(input?.prompt).toContain('Address the person as "you".');
	});

	test("a viewer may not ask: the answer costs this computer's agent", async () => {
		const harness = fakeHarness();
		await expect(
			explain(
				asked(
					"viewer",
					createAssistant(
						deps({ harnessFor: () => harness, space: runSpace(failed) }),
					),
				),
			),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		expect(harness.calls).toHaveLength(0);
	});

	test("a run that did not stop early has nothing to explain", async () => {
		const harness = fakeHarness();
		const events = await explain(
			asked(
				"member",
				createAssistant(
					deps({
						harnessFor: () => harness,
						space: runSpace({ ...failed, status: "finished" }),
					}),
				),
			),
		);
		expect(events).toEqual([{ type: "error", message: NOT_ENDED_EARLY }]);
		expect(harness.calls).toHaveLength(0);
	});

	test("a project without a Clone here: the agent works in a folder of its own", async () => {
		const harness = fakeHarness({
			steps: [{ type: "report", outcome: "", summary: "Sign in again." }],
		});
		const assistant = createAssistant(
			deps({
				harnessFor: () => harness,
				space: runSpace(failed),
				clonePath: async () => null,
				ownFolder: async () => "/data/assistant",
			}),
		);
		const events = await explain(asked("member", assistant));
		expect(events.at(-1)).toEqual({ type: "done" });
		expect(harness.calls[0]?.cwd).toBe("/data/assistant");
	});

	test("a model the person chose for the Explainer answers, with no agent and no folder", async () => {
		const asks: { decider: string; model?: string; prompt: string }[] = [];
		const assistant = createAssistant(
			deps({
				harnessFor: () => undefined,
				installed: () => false,
				clonePath: async () => null,
				space: runSpace(failed),
				settings: settings("", {
					explainer: { kind: "model", decider: "ollama", model: "llama3.2" },
				}),
				decide: async (input) => {
					asks.push({
						decider: input.decider,
						...(input.model ? { model: input.model } : {}),
						prompt: input.prompt,
					});
					return {
						kind: "made",
						data: { summary: "The test step failed. Try the run again." },
						costUsd: null,
					};
				},
			}),
		);
		const events = await explain(asked("member", assistant));
		expect(events.at(-2)).toEqual({
			type: "answer",
			answer: "The test step failed. Try the run again.",
		});
		expect(events.at(-1)).toEqual({ type: "done" });
		expect(asks).toHaveLength(1);
		expect(asks[0]).toMatchObject({ decider: "ollama", model: "llama3.2" });
		expect(asks[0]?.prompt).toContain("You cannot read files");
	});

	test("a model the person chose, on a computer that cannot ask one: says what to do", async () => {
		const assistant = createAssistant(
			deps({
				space: runSpace(failed),
				settings: settings("", {
					explainer: { kind: "model", decider: "ollama" },
				}),
			}),
		);
		const events = await explain(asked("member", assistant));
		expect(events.at(-1)).toEqual({ type: "error", message: NO_MODEL_HERE });
	});
});

describe("check", () => {
	const never = new AbortController().signal;
	/** A harness that answers the check with one word. */
	const ready = () =>
		fakeHarness({ steps: [{ type: "text", text: "ready" }], delayMs: 1 });
	const withAgent = (over: Partial<AssistantDeps> = {}) => {
		const harness = ready();
		return {
			harness,
			assistant: createAssistant(
				deps({
					harnessFor: (name) => (name === "claude-code" ? harness : undefined),
					ownFolder: async () => "/data/assistant",
					...over,
				}),
			),
		};
	};

	test("an agent answers: one small read-only question in the assistant's own folder, with no tools", async () => {
		const { harness, assistant } = withAgent();
		const result = await assistant.check("builder", never);
		expect(result).toMatchObject({
			id: "builder",
			ok: true,
			problem: null,
			answers: {
				kind: "agent",
				profile: "b_claude",
				harness: "claude-code",
				model: "sonnet",
			},
		});
		expect(result.ms).toBeGreaterThanOrEqual(0);
		expect(harness.calls).toHaveLength(1);
		const [input] = harness.calls;
		expect(input?.prompt).toBe("Answer with the one word: ready.");
		expect(input?.cwd).toBe("/data/assistant");
		expect(input?.readOnly).toBe(true);
		expect(input?.tools).toBeUndefined();
		expect(input?.stepReport).toBeUndefined();
		expect(input?.maxTurns).toBe(2);
		expect(input?.maxBudgetUsd).toBe(0.1);
	});

	test("the agent the person chose for the Explainer is the one asked", async () => {
		const { harness, assistant } = withAgent({
			settings: settings("", {
				explainer: { kind: "agent", harness: "claude-code", model: "haiku" },
			}),
		});
		const result = await assistant.check("explainer", never);
		expect(result.ok).toBe(true);
		expect(result.answers).toEqual({
			kind: "agent",
			profile: null,
			harness: "claude-code",
			model: "haiku",
		});
		expect(harness.calls[0]?.model).toBe("haiku");
	});

	test("the Builder on an agent without Night Shift's tools: the problem, and nothing is asked", async () => {
		const pi = fakeHarness();
		const assistant = createAssistant(
			deps({
				profiles: profiles({ p_pi: settingsOf("pi") }),
				settings: settings("", {
					builder: { kind: "agent", profile: "p_pi" },
				}),
				harnessFor: () => pi,
				installed: () => true,
				ownFolder: async () => "/data/assistant",
			}),
		);
		const result = await assistant.check("builder", never);
		expect(result.ok).toBe(false);
		expect(result.problem).toContain('The chat cannot use the profile "p_pi"');
		expect(pi.calls).toHaveLength(0);
		// The Explainer needs no tools: the same agent answers for it.
		expect((await assistant.check("explainer", never)).ok).toBe(true);
		expect(pi.calls).toHaveLength(1);
	});

	test("no agent on this computer: the problem says what to add", async () => {
		const assistant = createAssistant(deps({ profiles: profiles({}) }));
		expect(await assistant.check("improver", never)).toMatchObject({
			ok: false,
			answers: null,
			problem: NO_CHAT_PROFILE,
		});
		expect(await assistant.check("field-writer", never)).toMatchObject({
			ok: false,
			answers: null,
			problem: NO_PROFILE,
		});
	});

	test("an agent whose program is not on this computer: nothing is asked", async () => {
		const { harness, assistant } = withAgent({
			// The profile for help counts, also when its program is gone.
			settings: settings("b_claude"),
			installed: () => false,
		});
		const result = await assistant.check("builder", never);
		expect(result.ok).toBe(false);
		expect(result.problem).toBe(
			"Night Shift cannot find Claude Code on this computer. Install it, or choose another agent in Settings.",
		);
		expect(harness.calls).toHaveLength(0);
	});

	test("an agent that fails: a result with the problem, never a throw", async () => {
		const harness = fakeHarness({
			steps: [],
			outcome: { type: "error", kind: "harness", message: "Not signed in." },
			delayMs: 1,
		});
		const assistant = createAssistant(
			deps({
				harnessFor: () => harness,
				ownFolder: async () => "/data/assistant",
			}),
		);
		expect(await assistant.check("builder", never)).toMatchObject({
			ok: false,
			problem: "Claude Code did not answer. Not signed in.",
		});
	});

	test("an agent that takes too long: the check stops it and says so", async () => {
		const harness = fakeHarness({
			steps: [{ type: "wait", ms: 5_000 }],
			delayMs: 1,
		});
		const assistant = createAssistant(
			deps({
				harnessFor: () => harness,
				ownFolder: async () => "/data/assistant",
				checkTimeouts: { agentMs: 20, modelMs: 20 },
			}),
		);
		const result = await assistant.check("builder", never);
		expect(result.ok).toBe(false);
		expect(result.problem).toBe(
			"Claude Code did not answer in 1 seconds. Check that you are signed in to it, then try again.",
		);
		expect(harness.calls[0]?.signal.aborted).toBe(true);
	});

	test("the Decider with no choice: TypeSafe picks an option, as a Decision asks it", async () => {
		const asks: { decider: string; labels: string[] }[] = [];
		const assistant = createAssistant(
			deps({
				decideOption: async (input) => {
					asks.push({
						decider: input.decider,
						labels: input.labels.map((label) => label.name),
					});
					return { kind: "decided", label: "ready", notes: "", costUsd: 0 };
				},
			}),
		);
		expect(await assistant.check("decider", never)).toMatchObject({
			ok: true,
			answers: { kind: "model", decider: "typesafe" },
			problem: null,
		});
		expect(asks).toEqual([
			{ decider: "typesafe", labels: ["ready", "not ready"] },
		]);
	});

	test("the Decider without a call that picks: a value from a model that writes, else it cannot be checked", async () => {
		const values: string[] = [];
		const decide: AssistantDeps["decide"] = async (input) => {
			values.push(input.decider);
			return { kind: "made", data: { answer: "ready" }, costUsd: null };
		};
		const chosen = createAssistant(
			deps({
				settings: settings("", {
					decider: { kind: "model", decider: "ollama", model: "llama3.2" },
				}),
				decide,
			}),
		);
		expect(await chosen.check("decider", never)).toMatchObject({
			ok: true,
			answers: { kind: "model", decider: "ollama", model: "llama3.2" },
		});
		expect(values).toEqual(["ollama"]);
		// TypeSafe only picks an option.
		expect(
			await createAssistant(deps({ decide })).check("decider", never),
		).toMatchObject({ ok: false, problem: NO_CHECK_MODEL });
		expect(values).toEqual(["ollama"]);
	});

	test("the Brief writer with no choice: the model a Gate's brief asks writes one field", async () => {
		const asks: { decider: string; output: unknown }[] = [];
		const assistant = createAssistant(
			deps({
				decide: async (input) => {
					asks.push({ decider: input.decider, output: input.output });
					return { kind: "made", data: { answer: "ready" }, costUsd: null };
				},
			}),
		);
		expect(await assistant.check("brief-writer", never)).toMatchObject({
			ok: true,
			answers: { kind: "model", decider: "openrouter" },
		});
		expect(asks).toHaveLength(1);
		expect(asks[0]?.output).toMatchObject({ required: ["answer"] });
	});

	test("a model the person chose for the Field writer is asked, not an agent", async () => {
		const { harness, assistant } = withAgent({
			settings: settings("", {
				"field-writer": { kind: "model", decider: "openai", model: "gpt" },
			}),
			decide: async () => ({
				kind: "made",
				data: { answer: "ready" },
				costUsd: null,
			}),
		});
		expect(await assistant.check("field-writer", never)).toMatchObject({
			ok: true,
			answers: { kind: "model", decider: "openai", model: "gpt" },
		});
		expect(harness.calls).toHaveLength(0);
	});

	test("a model that fails, throws or takes too long: the problem with what to check", async () => {
		const failing = (decide: NonNullable<AssistantDeps["decide"]>) =>
			createAssistant(
				deps({ decide, checkTimeouts: { agentMs: 20, modelMs: 20 } }),
			).check("brief-writer", never);
		expect(
			await failing(async () => ({
				kind: "error",
				errorKind: "harness",
				message: "The key is not set",
				costUsd: null,
			})),
		).toMatchObject({
			ok: false,
			problem:
				"The model did not answer. The key is not set. Check its key and its model in Settings.",
		});
		expect(
			await failing(async () => {
				throw new Error("Boom.");
			}),
		).toMatchObject({
			ok: false,
			problem:
				"The model did not answer. Boom. Check its key and its model in Settings.",
		});
		expect(await failing(() => new Promise(() => {}))).toMatchObject({
			ok: false,
			problem:
				"The model did not answer in 1 seconds. Check its key and its model in Settings.",
		});
	});

	test("a model profile that is gone: the problem, and nothing is asked", async () => {
		let asked = 0;
		const assistant = createAssistant(
			deps({
				settings: settings("", {
					"brief-writer": { kind: "model", profile: "gone" },
				}),
				decide: async () => {
					asked += 1;
					return { kind: "made", data: {}, costUsd: null };
				},
			}),
		);
		const result = await assistant.check("brief-writer", never);
		expect(result.ok).toBe(false);
		expect(result.problem).toContain('There is no model profile "gone"');
		expect(asked).toBe(0);
	});
});
