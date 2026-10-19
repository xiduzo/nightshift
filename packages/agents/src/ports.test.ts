import { describe, expect, test } from "bun:test";

import { acpHarness } from "./acp";
import { claudeCodeHarness } from "./claude-code";
import { codexHarness } from "./codex";
import { DECIDER_ADAPTERS, tanstackDecider } from "./decider";
import { HARNESS_ADAPTERS } from "./doctor";
import { fakeDecider, fakeHarness } from "./fake";
import { grokBuildHarness } from "./grok-build";
import { shellQuote } from "./harness-facts";
import { opencodeHarness } from "./opencode";
import type { AgentHarness, Decider, DeciderName, HarnessName } from "./types";

/**
 * The engine asks its ports (`AgentHarness`, `Decider`), not the adapter
 * registries. Every adapter, and the fake at the same seam, must answer with
 * the values the registries hold.
 */

const harnesses: Record<HarnessName, AgentHarness> = {
	"claude-code": claudeCodeHarness(),
	opencode: opencodeHarness(),
	codex: codexHarness(),
	"grok-build": grokBuildHarness(),
	copilot: acpHarness("copilot", { executable: "copilot" }),
	gemini: acpHarness("gemini", { executable: "gemini" }),
	cursor: acpHarness("cursor", { executable: "agent" }),
};

describe("the AgentHarness port", () => {
	test("every registered adapter is built here", () => {
		expect(Object.keys(harnesses).sort()).toEqual(
			Object.keys(HARNESS_ADAPTERS).sort(),
		);
	});

	test.each(Object.keys(HARNESS_ADAPTERS) as HarnessName[])(
		"%s carries the registry's label and take-over command",
		(name) => {
			const harness = harnesses[name];
			const adapter = HARNESS_ADAPTERS[name];
			expect(harness.name).toBe(name);
			expect(harness.label).toBe(adapter.label);
			for (const id of ["session-1", "it's odd"]) {
				expect(harness.takeOverCommand(id)).toBe(
					adapter.takeOver?.(shellQuote(id)) ?? null,
				);
			}
		},
	);

	test("the fake harness answers as Claude Code does", () => {
		const fake = fakeHarness();
		expect(fake.label).toBe(harnesses["claude-code"].label);
		expect(fake.takeOverCommand("fake-session-1")).toBe(
			harnesses["claude-code"].takeOverCommand("fake-session-1"),
		);
	});

	test("a session id is quoted for the shell", () => {
		expect(harnesses["claude-code"].takeOverCommand("a b")).toBe(
			"claude --resume 'a b'",
		);
		expect(harnesses.copilot.takeOverCommand("x")).toBeNull();
	});
});

describe("the Decider port", () => {
	const deciders: Record<string, Decider> = {
		tanstack: tanstackDecider({ secret: async () => undefined }),
		fake: fakeDecider([]),
	};

	test.each(
		Object.keys(DECIDER_ADAPTERS).flatMap((name) =>
			Object.keys(deciders).map((kind) => [kind, name] as const),
		),
	)(
		"the %s decider's default models for %s match the registry",
		(kind, name) => {
			const decider = deciders[kind] as Decider;
			const adapter = DECIDER_ADAPTERS[name as DeciderName];
			expect(decider.defaultModel(name as DeciderName, "decision")).toBe(
				adapter.defaultModel,
			);
			expect(decider.defaultModel(name as DeciderName, "value")).toBe(
				adapter.value?.defaultModel ?? adapter.defaultModel,
			);
		},
	);
});
