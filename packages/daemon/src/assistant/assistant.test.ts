import { describe, expect, test } from "bun:test";
import { fakeHarness } from "@nightshift/agents/testing";
import { appRouter } from "@nightshift/api";
import type { Context } from "@nightshift/api/context";
import type { ProfileStore, SettingsStore } from "@nightshift/engine";
import type {
	AgentHarnessName,
	AgentProfileSettings,
	FlowInput,
	SuggestionEvent,
} from "@nightshift/flows";
import { call } from "@orpc/server";

import {
	type AssistantDeps,
	createAssistant,
	NO_CLONE,
	NO_PROFILE,
	pickProfile,
} from "./assistant";

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
