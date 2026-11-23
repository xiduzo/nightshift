import { describe, expect, test } from "bun:test";
import { translateSdkStream } from "@tanstack/ai-claude-code";

/**
 * The patch of `@tanstack/ai-claude-code` (`patches/` in the repository):
 * a tool call whose streamed arguments are not valid JSON must not end the
 * session. Claude Code refuses the call with an error result, and the
 * model calls again. Remove this test with the patch.
 */
describe("a tool call with arguments that are not valid JSON", () => {
	test("is passed on with its raw text, and the stream goes on", async () => {
		const raw = '{"outcome": "tested", "summary": "a "quoted" word"}';
		const messages = [
			{ event: { type: "message_start", message: { id: "m1" } } },
			{
				event: {
					type: "content_block_start",
					index: 0,
					content_block: {
						type: "tool_use",
						id: "t1",
						name: "mcp__tanstack__report_step",
						input: {},
					},
				},
			},
			{
				event: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "input_json_delta", partial_json: raw },
				},
			},
			{ event: { type: "content_block_stop", index: 0 } },
		].map((message) => ({
			type: "stream_event",
			parent_tool_use_id: null,
			...message,
		}));
		async function* sdk() {
			for (const message of messages) yield message;
		}
		const chunks: { type: string; input?: unknown }[] = [];
		let id = 0;
		for await (const chunk of translateSdkStream(sdk() as never, {
			model: "m",
			runId: "r",
			threadId: "t",
			genId: () => `g${++id}`,
		})) {
			chunks.push(chunk as { type: string; input?: unknown });
		}
		expect(
			chunks.find((chunk) => chunk.type === "TOOL_CALL_END"),
		).toMatchObject({ input: { __unparsedToolInput: { raw } } });
	});
});
