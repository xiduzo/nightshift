import { describe, expect, test } from "bun:test";
import { createTranslator } from "../../session/translate";
import { CLAUDE_CODE_PROFILE, REPORT_TOOL_ID } from "./profile";

describe("the Claude Code profile", () => {
	test("the report tool id is the bridged MCP name", () => {
		expect(REPORT_TOOL_ID).toBe("mcp__tanstack__report_step");
		expect(CLAUDE_CODE_PROFILE.reportToolId).toBe(REPORT_TOOL_ID);
	});

	test("a report under the bridged MCP name counts", () => {
		const t = createTranslator({
			fallbackSessionId: "f",
			stepReport: true,
			profile: CLAUDE_CODE_PROFILE,
		});
		const input = { outcome: "pass", summary: "Done." };
		const events = [
			{
				type: "TOOL_CALL_START",
				toolCallId: "c-1",
				toolCallName: REPORT_TOOL_ID,
			},
			{ type: "TOOL_CALL_END", toolCallId: "c-1", input },
			{
				type: "TOOL_CALL_RESULT",
				toolCallId: "c-1",
				content: "Step report recorded.",
			},
		].flatMap((chunk) => t.push(chunk));
		expect(events.filter((e) => e.type !== "session")).toEqual([]);
		expect(t.finish({ aborted: false })).toContainEqual({
			type: "report",
			outcome: "pass",
			summary: "Done.",
		});
	});
});
