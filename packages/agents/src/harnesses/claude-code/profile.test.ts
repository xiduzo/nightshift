import { describe, expect, test } from "bun:test";
import { createTranslator } from "../../session/translate";
import {
	CLAUDE_CODE_PROFILE,
	createClaudeCodeSubagentReader,
	REPORT_TOOL_ID,
} from "./profile";

describe("the Claude Code subagent reader", () => {
	test("turns a subagent's messages into events with its Task call", () => {
		const read = createClaudeCodeSubagentReader();
		const assistant = (content: unknown[]) => ({
			type: "assistant",
			parent_tool_use_id: "task-1",
			message: { id: "msg-1", content },
		});
		expect([
			...read(
				assistant([
					{
						type: "thinking",
						thinking: "Look at the tests.",
						signature: "sig",
					},
					{ type: "redacted_thinking", data: "EqQBCipher" },
					{ type: "thinking", thinking: "", signature: "sig" },
				]),
			),
			...read(assistant([{ type: "text", text: "I read it." }])),
			...read(
				assistant([
					{
						type: "tool_use",
						id: "s-c1",
						name: "mcp__tanstack__save_artifact",
						input: { name: "a" },
					},
				]),
			),
			...read({
				type: "user",
				parent_tool_use_id: "task-1",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "s-c1",
							content: [
								{ type: "text", text: "saved" },
								{ type: "text", text: "twice" },
							],
							is_error: true,
						},
					],
				},
			}),
		]).toEqual([
			{
				type: "thinking",
				messageId: "msg-1:1",
				delta: "Look at the tests.",
				parentToolCallId: "task-1",
			},
			{
				type: "text",
				messageId: "msg-1:2",
				delta: "I read it.",
				parentToolCallId: "task-1",
			},
			{
				type: "tool-start",
				toolCallId: "s-c1",
				name: "save_artifact",
				parentToolCallId: "task-1",
			},
			{
				type: "tool-end",
				toolCallId: "s-c1",
				name: "save_artifact",
				input: { name: "a" },
				parentToolCallId: "task-1",
			},
			{
				type: "tool-result",
				toolCallId: "s-c1",
				content: "saved\ntwice",
				isError: true,
				parentToolCallId: "task-1",
			},
		]);
	});

	test("reads nothing from the session agent's own messages or partial ones", () => {
		const read = createClaudeCodeSubagentReader();
		expect(
			read({
				type: "assistant",
				parent_tool_use_id: null,
				message: { id: "m", content: [{ type: "text", text: "hi" }] },
			}),
		).toEqual([]);
		expect(
			read({
				type: "stream_event",
				parent_tool_use_id: "task-1",
				event: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: "hi" },
				},
			}),
		).toEqual([]);
		expect(read({ type: "result", subtype: "success" })).toEqual([]);
		// The subagent's prompt, forwarded as a user message, is the call's input.
		expect(
			read({
				type: "user",
				parent_tool_use_id: "task-1",
				message: { role: "user", content: [{ type: "text", text: "Do x." }] },
			}),
		).toEqual([]);
	});
});

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
