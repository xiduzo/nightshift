import { describe, expect, test } from "bun:test";
import type { BuiltinStatus } from "@nightshift/flows";
import {
	answerOptions,
	askWhyPick,
	DEFAULT,
	takesEffort,
} from "./ask-why-pick";

const status = (answers: BuiltinStatus["answers"]): BuiltinStatus => ({
	id: "explainer",
	chosen: true,
	answers,
	problem: null,
});

const opus = status({
	kind: "agent",
	profile: "opus",
	harness: "claude-code",
	model: "opus",
});

describe("answerOptions", () => {
	test("the default first, then the Host's agents, its models and its deciders", () => {
		expect(
			answerOptions(
				opus,
				[
					{ name: "sonnet", harness: "claude-code" },
					{ name: "gemma", decider: "ollama" },
				],
				[{ name: "typesafe", label: "TypeSafe" }],
			),
		).toEqual([
			{ value: DEFAULT, label: "Default · opus" },
			{ value: "agent:sonnet", label: "sonnet" },
			{ value: "model:gemma", label: "gemma" },
			{ value: "decider:typesafe", label: "TypeSafe" },
		]);
	});
});

describe("askWhyPick", () => {
	test("the default with no effort sends nothing: the Host chooses", () => {
		expect(askWhyPick(DEFAULT, DEFAULT, opus)).toEqual({});
	});

	test("an effort on the default names the default's agent", () => {
		expect(askWhyPick(DEFAULT, "high", opus)).toEqual({
			profile: "opus",
			effort: "high",
		});
	});

	test("an agent, a model profile or a decider of the Host", () => {
		expect(askWhyPick("agent:sonnet", "low", opus)).toEqual({
			profile: "sonnet",
			effort: "low",
		});
		expect(askWhyPick("model:gemma", "high", opus)).toEqual({
			modelAnswer: { kind: "model", profile: "gemma" },
		});
		expect(askWhyPick("decider:typesafe", DEFAULT, opus)).toEqual({
			modelAnswer: { kind: "model", decider: "typesafe" },
		});
	});

	test("a model has no effort", () => {
		const model = status({ kind: "model", decider: "ollama" });
		expect(takesEffort(DEFAULT, model)).toBe(false);
		expect(askWhyPick(DEFAULT, "high", model)).toEqual({});
	});
});
