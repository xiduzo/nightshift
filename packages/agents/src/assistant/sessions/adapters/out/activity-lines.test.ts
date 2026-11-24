import { describe, expect, test } from "bun:test";
import { bareToolName } from "../../../catalog";
import { activityOf } from "./activity-lines";

describe("activityOf", () => {
	test("plain words for each harness's read tools, never a tool name", () => {
		const cwd = "/repo";
		expect(activityOf("Read", { file_path: "/repo/package.json" }, cwd)).toBe(
			"Reads package.json",
		);
		expect(activityOf("read", { filePath: "src/a.ts" }, cwd)).toBe(
			"Reads src/a.ts",
		);
		expect(activityOf("Grep", { pattern: "TODO" }, cwd)).toBe(
			'Searches for "TODO"',
		);
		expect(activityOf("Glob", { pattern: "**/*.md" }, cwd)).toBe(
			"Looks for files like **/*.md",
		);
		expect(activityOf("ls", {}, cwd)).toBe("Lists the project folder");
		expect(activityOf("mcp__tanstack__report_step", {}, cwd)).toBe(
			"Writes the answer",
		);
		expect(activityOf("tanstack_report_step", {}, cwd)).toBe(
			"Writes the answer",
		);
		expect(activityOf("TodoWrite", {}, cwd)).toBeNull();
		expect(activityOf("mystery_tool", {}, cwd)).toBe(
			"Looks through the project",
		);
	});

	test("Night Shift's own tools are named by the caller", () => {
		expect(
			activityOf("mcp__tanstack__get_draft", {}, "/", (name) =>
				name === "get_draft" ? "Reads the flow" : undefined,
			),
		).toBe("Reads the flow");
		expect(bareToolName("mcp__my_server__do_it")).toBe("do_it");
	});
});
