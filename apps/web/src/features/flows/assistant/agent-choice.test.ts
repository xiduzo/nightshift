import { describe, expect, test } from "bun:test";
import { parseAgentChoice, requestAgent } from "./agent-choice";

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
