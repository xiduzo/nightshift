import { describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { appRouter } from "@nightshift/api";
import type { Context } from "@nightshift/api/context";
import type { ProfileStore, SettingsStore } from "@nightshift/engine";
import type {
	AgentHarnessName,
	AgentProfileSettings,
	ChatEvent,
	ChatRequest,
	FlowInput,
	SuggestionEvent,
} from "@nightshift/flows";
import { call } from "@orpc/server";

import {
	type AssistantDeps,
	BUSY,
	createAssistant,
	NO_CLONE,
	NO_PROFILE,
	pickProfile,
} from "./assistant";
import { type ChatSpace, chatRun } from "./authoring";

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
				name,
				updatedAt: 0,
			})),
	};
}

const settings = (assistantProfile = ""): Pick<SettingsStore, "current"> => ({
	current: () => ({ assistantProfile }) as ReturnType<SettingsStore["current"]>,
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
			flowMap: async () => ({ fix: null }),
			getRun: async () => {
				throw new Error("No such run");
			},
			watchRun: async function* () {},
		}),
		cliTools: { list: () => [] },
		connections: { list: () => [] },
		skills: async () => [],
		...over,
	};
}

describe("pickProfile", () => {
	test("the request's profile first", () => {
		expect(pickProfile("a_codex", deps())).toMatchObject({ name: "a_codex" });
		expect(pickProfile("gone", deps())).toEqual({
			error:
				'There is no profile "gone" on this computer. Pick another one, or add it on the Agents page.',
		});
	});

	test("then the setting, then the first profile whose harness is here", () => {
		expect(
			pickProfile(undefined, deps({ settings: settings("a_codex") })),
		).toMatchObject({ name: "a_codex" });
		// A profile in the settings that is gone falls back.
		expect(
			pickProfile(undefined, deps({ settings: settings("gone") })),
		).toMatchObject({ name: "b_claude", settings: { model: "sonnet" } });
		expect(pickProfile(undefined, deps())).toMatchObject({ name: "b_claude" });
	});

	test("none: tells the person to add one", () => {
		expect(pickProfile(undefined, deps({ installed: () => false }))).toEqual({
			error: NO_PROFILE,
		});
	});
});

const flow: FlowInput = {
	version: 5,
	inputs: [{ name: "issue", type: "text" }],
	start: "plan",
	nodes: [
		{
			id: "plan",
			type: "agent",
			position: { x: 0, y: 0 },
			profile: "worker",
			prompt: "Plan {{issue}}.",
		},
	],
	edges: [],
};

/** The owner of this computer, signed in. */
function context(assistant: Context["assistant"]): Context {
	return {
		session: { user: { id: "owner" } },
		spaceId: "space",
		hostAccess: { allowed: true },
		engine: { space: () => ({}) },
		daemon: { device: { id: "d", name: "test", ownerId: "owner" } },
		assistant,
	} as unknown as Context;
}

async function suggest(
	assistant: Context["assistant"],
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

	test("ends with an error the person can act on", async () => {
		expect(
			await suggest(createAssistant(deps({ clonePath: async () => null }))),
		).toEqual([{ type: "error", message: NO_CLONE }]);
		expect(
			await suggest(createAssistant(deps({ installed: () => false }))),
		).toEqual([{ type: "error", message: NO_PROFILE }]);
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
			"Choose a profile that uses Claude Code, Codex or OpenCode for the chat.",
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
	const entry = (seq: number, stepId: string, event: unknown) => ({
		kind: "transcript",
		entry: { seq, stepId, sessionId: null, at: seq, event },
	});
	const space = (): ChatSpace =>
		({
			flowMap: async () => ({}),
			getRun: async (id: string) => {
				if (id !== "r1") throw new Error("No such run");
				return run;
			},
			watchRun: async function* (
				_id: string,
				{ signal }: { signal: AbortSignal },
			) {
				yield { kind: "status", status: "failed" };
				yield entry(1, "s1", { type: "text", messageId: "m", delta: "Plan" });
				yield entry(2, "s2", { type: "command-start", command: "bun test" });
				for (let i = 0; i < 1000; i++) {
					yield entry(3 + i, "s2", {
						type: "command-output",
						stream: "stdout",
						text: `line ${i}\n`,
					});
				}
				yield entry(2000, "s2", { type: "command-exit", exitCode: 1 });
				// Live: nothing more comes until the reader lets go.
				await new Promise((resolve) =>
					signal.addEventListener("abort", resolve, { once: true }),
				);
			},
		}) as unknown as ChatSpace;

	test("the failed step and the end of its transcript, bounded; it stops once the replay is done", async () => {
		const started = Date.now();
		const found = await chatRun(space(), "p1", "r1", {
			signal: new AbortController().signal,
			idleMs: 50,
		});
		expect(Date.now() - started).toBeLessThan(2_000);
		expect(found?.failedStepId).toBe("s2");
		expect(found?.steps[0]?.note).toBe("Planned.");
		expect(found?.transcript.at(-1)).toBe("Exit code: 1");
		expect(found?.transcript).toContain("line 999");
		expect(found?.transcript).not.toContain("$ bun test");
		expect(found?.transcript.length).toBeLessThanOrEqual(300);
	});

	test("a failure inside a called flow: that step, with the flow it ran in", async () => {
		const nested = {
			...run,
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
		};
		const found = await chatRun(
			{
				flowMap: async () => ({}),
				getRun: async () => nested,
				watchRun: async function* () {},
			} as unknown as ChatSpace,
			"p1",
			"r1",
			{ signal: new AbortController().signal },
		);
		expect(found?.failedStepId).toBe("c2");
		expect(found?.steps.map((s) => s.flow)).toEqual([null, "build-task"]);
	});

	test("a run of another project, or none: null", async () => {
		const signal = new AbortController().signal;
		expect(await chatRun(space(), "p2", "r1", { signal })).toBeNull();
		expect(await chatRun(space(), "p1", "nope", { signal })).toBeNull();
	});
});
