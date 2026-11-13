import { describe, expect, test } from "bun:test";
import type { BuiltinStatus } from "@nightshift/flows";

import {
	answerOfAgent,
	answerOfModel,
	deciderOfValue,
	limitText,
	shownAnswer,
} from "./builtin-answer";

describe("the answer for a pick", () => {
	test("a profile is saved by its name, with what the person changed on it", () => {
		expect(answerOfAgent({ profile: "worker" })).toEqual({
			kind: "agent",
			profile: "worker",
		});
		expect(
			answerOfAgent({ profile: "worker", model: "haiku", effort: "low" }),
		).toEqual({
			kind: "agent",
			profile: "worker",
			model: "haiku",
			effort: "low",
		});
	});

	test("a harness and a model are saved without a profile", () => {
		expect(answerOfAgent({ harness: "claude-code", model: "sonnet" })).toEqual({
			kind: "agent",
			harness: "claude-code",
			model: "sonnet",
		});
	});

	test("nothing picked, or a harness without a model, saves nothing", () => {
		expect(answerOfAgent({})).toBeNull();
		expect(answerOfAgent({ harness: "claude-code" })).toBeNull();
	});

	test("a model of the list is a Model Profile or a decider", () => {
		expect(answerOfModel("profile:fast")).toEqual({
			kind: "model",
			profile: "fast",
		});
		expect(answerOfModel("decider:ollama")).toEqual({
			kind: "model",
			decider: "ollama",
		});
		expect(answerOfModel("decider:no-such-decider")).toBeNull();
		expect(answerOfModel("profile:")).toBeNull();
		expect(answerOfModel("qwen3")).toBeNull();
	});

	test("only a decider value names a decider", () => {
		expect(deciderOfValue("decider:typesafe")).toBe("typesafe");
		expect(deciderOfValue("profile:typesafe")).toBeUndefined();
	});
});

describe("what the picker shows", () => {
	const status = (answers: BuiltinStatus["answers"]): BuiltinStatus => ({
		id: "explainer",
		chosen: false,
		answers,
		problem: null,
	});

	test("the saved answer comes first", () => {
		expect(
			shownAnswer(
				{ kind: "model", profile: "fast" },
				status({
					kind: "agent",
					profile: "worker",
					harness: "claude-code",
					model: "sonnet",
				}),
			),
		).toEqual({ agent: {}, model: "profile:fast" });
		expect(
			shownAnswer(
				{ kind: "agent", profile: "worker", effort: "high" },
				undefined,
			),
		).toEqual({
			agent: { profile: "worker", effort: "high" },
			model: undefined,
		});
		expect(
			shownAnswer({ kind: "model", decider: "ollama" }, undefined),
		).toEqual({ agent: {}, model: "decider:ollama" });
	});

	test("with nothing saved, it shows what this computer uses now", () => {
		expect(
			shownAnswer(
				undefined,
				status({
					kind: "agent",
					profile: "worker",
					harness: "claude-code",
					model: "sonnet",
				}),
			),
		).toEqual({ agent: { profile: "worker" }, model: undefined });
		expect(
			shownAnswer(
				undefined,
				status({
					kind: "agent",
					profile: null,
					harness: "codex",
					model: "gpt-5",
				}),
			),
		).toEqual({
			agent: { harness: "codex", model: "gpt-5" },
			model: undefined,
		});
		expect(
			shownAnswer(undefined, status({ kind: "model", decider: "typesafe" })),
		).toEqual({ agent: {}, model: "decider:typesafe" });
		expect(
			shownAnswer(
				undefined,
				status({ kind: "model", profile: "fast", decider: "ollama" }),
			),
		).toEqual({ agent: {}, model: "profile:fast" });
	});

	test("with nothing saved and nothing that can answer, it shows nothing", () => {
		expect(shownAnswer(undefined, status(null))).toEqual({
			agent: {},
			model: undefined,
		});
		expect(shownAnswer(undefined, undefined)).toEqual({
			agent: {},
			model: undefined,
		});
	});
});

describe("the most an answer spends", () => {
	test("an agent has an amount and its turns, a model makes one call", () => {
		expect(limitText({ turns: 40, usd: 2 })).toBe("$2.00 · 40 turns");
		expect(limitText({ usd: 0.5 })).toBe("$0.50");
		expect(limitText({ turns: 1 })).toBe("1 turn");
		expect(limitText({})).toBe("One call");
	});
});
