import { describe, expect, test } from "bun:test";
import type { BuiltinStatus } from "@nightshift/flows";
import { defaultRequest, overrideRequest } from "./picked-answer";

const status = (answers: BuiltinStatus["answers"]): BuiltinStatus => ({
	id: "field-writer",
	chosen: false,
	answers,
	problem: null,
});

const claudeDefault = () => "sonnet";

describe("defaultRequest", () => {
	test("sends the answer saved in Settings, its overrides kept", () => {
		expect(
			defaultRequest(
				{ kind: "agent", profile: "opus", effort: "high" },
				status(null),
			),
		).toEqual({ profile: "opus", effort: "high" });
		expect(
			defaultRequest(
				{ kind: "model", decider: "openai", model: "gpt" },
				undefined,
			),
		).toEqual({
			modelAnswer: { kind: "model", decider: "openai", model: "gpt" },
		});
	});

	test("without a saved answer, sends what the computer uses now", () => {
		expect(
			defaultRequest(
				undefined,
				status({
					kind: "agent",
					profile: "opus",
					harness: "claude-code",
					model: "opus",
				}),
			),
		).toEqual({ profile: "opus" });
		expect(
			defaultRequest(
				undefined,
				status({
					kind: "agent",
					profile: null,
					harness: "codex",
					model: "gpt-5",
					effort: "low",
				}),
			),
		).toEqual({ harness: "codex", model: "gpt-5", effort: "low" });
		expect(
			defaultRequest(undefined, status({ kind: "model", decider: "typesafe" })),
		).toEqual({ modelAnswer: { kind: "model", decider: "typesafe" } });
	});

	test("sends nothing while nothing is known: the computer decides", () => {
		expect(defaultRequest(undefined, undefined)).toEqual({});
		expect(defaultRequest(undefined, status(null))).toEqual({});
	});
});

describe("overrideRequest", () => {
	test("an agent pick fills in the harness's default model", () => {
		expect(
			overrideRequest(
				{ agent: { harness: "claude-code", effort: "max" } },
				claudeDefault,
			),
		).toEqual({ harness: "claude-code", model: "sonnet", effort: "max" });
	});

	test("a model pick names its model profile or decider", () => {
		expect(
			overrideRequest(
				{ model: { kind: "model", profile: "gemma" } },
				claudeDefault,
			),
		).toEqual({
			modelAnswer: { kind: "model", profile: "gemma" },
		});
		expect(
			overrideRequest(
				{ model: { kind: "model", decider: "ollama" } },
				claudeDefault,
			),
		).toEqual({
			modelAnswer: { kind: "model", decider: "ollama" },
		});
	});
});
