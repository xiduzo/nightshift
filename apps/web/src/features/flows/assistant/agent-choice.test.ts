import { describe, expect, test } from "bun:test";
import {
	parseAgentChoice,
	pickModel,
	profileModel,
	requestAgent,
} from "./agent-choice";

const defaultModel = (harness: string) =>
	harness === "claude-code" ? "sonnet" : "default";

describe("parseAgentChoice", () => {
	test("keeps the agent fields, and nothing else", () => {
		expect(
			parseAgentChoice(
				JSON.stringify({ profile: "worker", model: "haiku", other: 1 }),
			),
		).toEqual({ profile: "worker", model: "haiku" });
	});

	test("nothing, or something broken: the profile for help", () => {
		expect(parseAgentChoice(null)).toEqual({});
		expect(parseAgentChoice("{not json")).toEqual({});
		expect(parseAgentChoice('"text"')).toEqual({});
	});
});

describe("requestAgent", () => {
	test("the profile for help sends nothing", () => {
		expect(requestAgent({}, defaultModel)).toEqual({});
	});

	test("a profile sends its overrides only", () => {
		expect(
			requestAgent(
				{ profile: "worker", model: " ", effort: "low" },
				defaultModel,
			),
		).toEqual({ profile: "worker", effort: "low" });
	});

	test("no profile: a blank model is the harness's default", () => {
		expect(
			requestAgent({ harness: "claude-code", model: "" }, defaultModel),
		).toEqual({ harness: "claude-code", model: "sonnet" });
		expect(
			requestAgent({ harness: "claude-code", model: "haiku" }, defaultModel),
		).toEqual({ harness: "claude-code", model: "haiku" });
	});
});

describe("pickModel", () => {
	const worker = { name: "worker", harness: "claude-code" as const };
	const opus = { harness: "claude-code" as const, model: "opus" };
	const gpt = { harness: "codex" as const, model: "gpt-5" };

	test("a profile in use: the pick overrides its model", () => {
		expect(
			pickModel({ profile: "worker", effort: "low" }, opus, worker),
		).toEqual({ profile: "worker", model: "opus", effort: "low" });
	});

	test("a model of another harness overrides the harness too", () => {
		expect(pickModel({ profile: "worker" }, gpt, worker)).toEqual({
			profile: "worker",
			harness: "codex",
			model: "gpt-5",
		});
	});

	test("back on the profile's harness drops the harness override", () => {
		expect(
			pickModel(
				{ profile: "worker", harness: "codex", model: "x" },
				opus,
				worker,
			),
		).toEqual({ profile: "worker", model: "opus" });
	});

	test("the profile for help: the pick pins that profile", () => {
		expect(pickModel({}, opus, worker)).toEqual({
			profile: "worker",
			model: "opus",
		});
	});

	test("no profile, or none for help: the harness and model answer", () => {
		expect(
			pickModel({ harness: "codex", model: "a", effort: "high" }, opus, worker),
		).toEqual({ harness: "claude-code", model: "opus", effort: "high" });
		expect(pickModel({}, gpt, undefined)).toEqual(gpt);
	});
});

describe("profileModel", () => {
	test("drops the harness and model overrides only", () => {
		expect(
			profileModel({
				profile: "worker",
				harness: "codex",
				model: "x",
				effort: "low",
			}),
		).toEqual({ profile: "worker", effort: "low" });
	});
});
