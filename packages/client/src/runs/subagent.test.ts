import { describe, expect, test } from "bun:test";
import { isLaunchNotice, subagentTask } from "./subagent";

describe("a subagent's task", () => {
	test("reads the Agent tool's input, as Claude Code 2 sends it", () => {
		expect(
			subagentTask("Agent", {
				description: "List directory files",
				subagent_type: "Explore",
				prompt: "List the files here, one line.",
			}),
		).toEqual({
			agent: "Explore",
			description: "List directory files",
			prompt: "List the files here, one line.",
			model: null,
		});
	});

	test("reads the older Task tool too, with its model", () => {
		expect(
			subagentTask("Task", { prompt: "Review it.", model: "haiku" }),
		).toMatchObject({ agent: null, prompt: "Review it.", model: "haiku" });
	});

	test("any other call, or one without a task, starts no subagent", () => {
		expect(subagentTask("Bash", { prompt: "x" })).toBeNull();
		expect(subagentTask("Task", { id: 3 })).toBeNull();
		expect(subagentTask("Agent", "text")).toBeNull();
	});
});

describe("the launch notice", () => {
	test("is the result of a subagent that runs in the background", () => {
		expect(
			isLaunchNotice(
				"Async agent launched successfully. (This tool result is internal metadata.)",
			),
		).toBe(true);
		expect(isLaunchNotice("The tests are in parser.test.ts.")).toBe(false);
	});
});
