import { describe, expect, test } from "bun:test";
import { answersLabel, builtinSettingsSearch } from "./answers";

const label = (harness: string) =>
	harness === "claude-code" ? "Claude Code" : harness;

describe("what answers for a built-in agent", () => {
	test("a profile shows by its name", () => {
		expect(
			answersLabel(
				{
					kind: "agent",
					profile: "sonnet",
					harness: "claude-code",
					model: "sonnet",
				},
				label,
			),
		).toBe("sonnet");
		expect(
			answersLabel(
				{ kind: "model", profile: "local", decider: "ollama" },
				label,
			),
		).toBe("local");
	});

	test("without a profile: the harness and its model, or the model", () => {
		expect(
			answersLabel(
				{
					kind: "agent",
					profile: null,
					harness: "claude-code",
					model: "haiku",
				},
				label,
			),
		).toBe("Claude Code · haiku");
		expect(
			answersLabel(
				{ kind: "model", decider: "ollama", model: "gemma3" },
				label,
			),
		).toBe("ollama · gemma3");
		expect(answersLabel({ kind: "model", decider: "typesafe" }, label)).toBe(
			"typesafe",
		);
	});

	test("the Settings page of an agent", () => {
		expect(builtinSettingsSearch("improver")).toEqual({
			section: "builtin",
			agent: "improver",
		});
	});
});
