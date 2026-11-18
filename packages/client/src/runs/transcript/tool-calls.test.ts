import { describe, expect, test } from "bun:test";
import { groupToolCalls, toolCallsSummary, toolKind } from "./tool-calls";

describe("toolKind", () => {
	test("reads the tools of Claude Code", () => {
		expect(toolKind("Bash")).toBe("command");
		expect(toolKind("Read")).toBe("read");
		expect(toolKind("Edit")).toBe("edit");
		expect(toolKind("Write")).toBe("edit");
		expect(toolKind("MultiEdit")).toBe("edit");
		expect(toolKind("NotebookEdit")).toBe("edit");
		expect(toolKind("Grep")).toBe("search");
		expect(toolKind("Glob")).toBe("search");
		expect(toolKind("WebFetch")).toBe("web");
		expect(toolKind("WebSearch")).toBe("web");
	});

	test("reads the tools of Codex, OpenCode and pi", () => {
		expect(toolKind("shell")).toBe("command");
		expect(toolKind("exec_command")).toBe("command");
		expect(toolKind("local_shell")).toBe("command");
		expect(toolKind("apply_patch")).toBe("edit");
		expect(toolKind("bash")).toBe("command");
		expect(toolKind("read")).toBe("read");
		expect(toolKind("write")).toBe("edit");
		expect(toolKind("grep")).toBe("search");
		expect(toolKind("ls")).toBe("search");
		expect(toolKind("find")).toBe("search");
		expect(toolKind("webfetch")).toBe("web");
	});

	test("a todo list and unknown tools are other", () => {
		expect(toolKind("TodoWrite")).toBe("other");
		expect(toolKind("todowrite")).toBe("other");
		expect(toolKind("Agent")).toBe("other");
		expect(toolKind("mcp__tracker__get_issue")).toBe("other");
	});
});

describe("toolCallsSummary", () => {
	test("counts each kind in a fixed order", () => {
		expect(
			toolCallsSummary([
				"Edit",
				"Bash",
				"Read",
				"Bash",
				"Read",
				"Write",
				"Bash",
				"Read",
				"Bash",
				"Bash",
				"Bash",
			]),
		).toBe("Ran 6 commands · read 3 files · edited 2 files");
	});

	test("one of a kind reads in the singular", () => {
		expect(toolCallsSummary(["Bash"])).toBe("Ran 1 command");
		expect(toolCallsSummary(["Read", "Grep"])).toBe(
			"Read 1 file · searched once",
		);
		expect(toolCallsSummary(["Glob", "Grep", "Agent"])).toBe(
			"Searched 2 times · used 1 tool",
		);
		expect(toolCallsSummary(["WebFetch", "WebSearch", "Agent", "Task"])).toBe(
			"Opened 2 web pages · used 2 tools",
		);
	});

	test("no calls is empty", () => {
		expect(toolCallsSummary([])).toBe("");
	});
});

describe("groupToolCalls", () => {
	const isTool = (item: string) => item.startsWith("tool");

	test("folds a run of tool calls between other items", () => {
		expect(
			groupToolCalls(
				["message", "tool1", "tool2", "tool3", "message2", "tool4"],
				isTool,
			),
		).toEqual([
			{ kind: "item", item: "message" },
			{ kind: "tool-calls", items: ["tool1", "tool2", "tool3"] },
			{ kind: "item", item: "message2" },
			{ kind: "item", item: "tool4" },
		]);
	});

	test("a run at the end and at the start", () => {
		expect(groupToolCalls(["tool1", "tool2"], isTool)).toEqual([
			{ kind: "tool-calls", items: ["tool1", "tool2"] },
		]);
	});

	test("nothing to fold", () => {
		expect(groupToolCalls([], isTool)).toEqual([]);
		expect(groupToolCalls(["a", "b"], isTool)).toEqual([
			{ kind: "item", item: "a" },
			{ kind: "item", item: "b" },
		]);
	});
});
