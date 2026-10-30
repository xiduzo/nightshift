import { describe, expect, spyOn, test } from "bun:test";
import { Refusal } from "@nightshift/refusal";
import {
	CLAUDE_CODE_PROFILE,
	observeSdkMessage,
} from "../harnesses/claude-code/profile";
import { CODEX_PROFILE } from "../harnesses/codex/harness";
import type { AgentEvent } from "../port/types";
import {
	createTranslator,
	failureKind,
	type HarnessProfile,
	isNetworkText,
	isUsageLimitText,
	parseLegacyResetAt,
	type SdkSignals,
	type Translator,
} from "./translate";

const session = {
	type: "CUSTOM",
	name: "claude-code.session-id",
	value: { sessionId: "s-1", model: "claude-haiku-4-5", tools: ["Read"] },
};

const runFinished = {
	type: "RUN_FINISHED",
	runId: "r",
	threadId: "t",
	finishReason: "stop",
	usage: {
		promptTokens: 1200,
		completionTokens: 34,
		totalTokens: 1234,
		providerUsageDetails: { totalCostUsd: 0.0123 },
	},
};

function feed(
	translator: Translator,
	chunks: unknown[],
	finish: Parameters<Translator["finish"]>[0] = { aborted: false },
): AgentEvent[] {
	return [
		...chunks.flatMap((chunk) => translator.push(chunk)),
		...translator.finish(finish),
	];
}

const newTranslator = () =>
	createTranslator({
		fallbackSessionId: "fallback",
		profile: CLAUDE_CODE_PROFILE,
	});

describe("createTranslator", () => {
	test("maps a full session", () => {
		const events = feed(newTranslator(), [
			{ type: "RUN_STARTED", runId: "r", threadId: "t" },
			session,
			{ type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
			{ type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Hel" },
			{ type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "lo" },
			{ type: "TEXT_MESSAGE_END", messageId: "m1" },
			{ type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "Read" },
			{ type: "TOOL_CALL_ARGS", toolCallId: "c1", delta: '{"file' },
			{
				type: "TOOL_CALL_END",
				toolCallId: "c1",
				toolCallName: "Read",
				metadata: { tanstack: { input: { file_path: "a.txt" } } },
			},
			{
				type: "TOOL_CALL_RESULT",
				toolCallId: "c1",
				messageId: "x",
				content: "hi",
			},
			{ type: "REASONING_START", messageId: "r1" },
			runFinished,
		]);
		expect(events).toEqual([
			{ type: "session", sessionId: "s-1", model: "claude-haiku-4-5" },
			{ type: "text", messageId: "m1", delta: "Hel" },
			{ type: "text", messageId: "m1", delta: "lo" },
			{ type: "tool-start", toolCallId: "c1", name: "Read" },
			{
				type: "tool-end",
				toolCallId: "c1",
				name: "Read",
				input: { file_path: "a.txt" },
			},
			{ type: "tool-result", toolCallId: "c1", content: "hi" },
			{
				type: "finished",
				usage: { inputTokens: 1200, outputTokens: 34, costUsd: 0.0123 },
			},
		]);
	});

	test("visible thinking becomes thinking events; encrypted thinking goes nowhere", () => {
		const events = feed(newTranslator(), [
			session,
			{ type: "REASONING_START", messageId: "r1" },
			{ type: "REASONING_MESSAGE_START", messageId: "r1", role: "reasoning" },
			{ type: "REASONING_MESSAGE_CONTENT", messageId: "r1", delta: "Read " },
			{ type: "REASONING_MESSAGE_CONTENT", messageId: "r1", delta: "it." },
			{ type: "REASONING_MESSAGE_CONTENT", messageId: "r1", delta: "" },
			{
				type: "REASONING_ENCRYPTED_VALUE",
				subtype: "message",
				entityId: "r1",
				encryptedValue: "EqQBCkYIBxgCKkCipher",
			},
			{ type: "REASONING_MESSAGE_END", messageId: "r1" },
			{ type: "REASONING_END", messageId: "r1" },
			{ type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "Done" },
			runFinished,
		]);
		expect(events.slice(0, 4)).toEqual([
			{ type: "session", sessionId: "s-1", model: "claude-haiku-4-5" },
			{ type: "thinking", messageId: "r1", delta: "Read " },
			{ type: "thinking", messageId: "r1", delta: "it." },
			{ type: "text", messageId: "m1", delta: "Done" },
		]);
		expect(JSON.stringify(events)).not.toContain("Cipher");
	});

	test("a subagent's events from the raw messages wait for the session, then go first", () => {
		const t = newTranslator();
		const subagent = {
			type: "assistant",
			parent_tool_use_id: "task-1",
			message: { id: "msg-s", content: [{ type: "text", text: "Looking" }] },
		};
		t.observeSdk(subagent);
		expect(t.drain()).toEqual([]);
		expect(t.push(session)).toEqual([
			{ type: "session", sessionId: "s-1", model: "claude-haiku-4-5" },
			{
				type: "text",
				messageId: "msg-s:1",
				delta: "Looking",
				parentToolCallId: "task-1",
			},
		]);
		t.observeSdk(subagent);
		expect(t.drain()).toEqual([
			{
				type: "text",
				messageId: "msg-s:2",
				delta: "Looking",
				parentToolCallId: "task-1",
			},
		]);
		expect(t.drain()).toEqual([]);
	});

	test("whenQueued resolves once a subagent's event is queued", async () => {
		const t = newTranslator();
		t.push(session);
		let woke = false;
		const waiting = t.whenQueued().then(() => {
			woke = true;
		});
		t.observeSdk({
			type: "assistant",
			parent_tool_use_id: null,
			message: { content: [] },
		});
		await Bun.sleep(0);
		expect(woke).toBe(false);
		t.observeSdk({
			type: "user",
			parent_tool_use_id: "task-1",
			message: {
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "s-c1", content: "ok" }],
			},
		});
		await waiting;
		expect(t.drain()).toEqual([
			{
				type: "tool-result",
				toolCallId: "s-c1",
				content: "ok",
				parentToolCallId: "task-1",
			},
		]);
	});

	test("reads tool input from the chunk itself and falls back to toolName", () => {
		const events = feed(newTranslator(), [
			session,
			{
				type: "TOOL_CALL_END",
				toolCallId: "c1",
				toolName: "Bash",
				input: { command: "ls" },
			},
			runFinished,
		]);
		expect(events[1]).toEqual({
			type: "tool-end",
			toolCallId: "c1",
			name: "Bash",
			input: { command: "ls" },
		});
	});

	test("takes the tool name from TOOL_CALL_START when TOOL_CALL_END lacks it", () => {
		const events = feed(newTranslator(), [
			session,
			{ type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "Read" },
			{ type: "TOOL_CALL_END", toolCallId: "c1", input: {} },
			runFinished,
		]);
		expect(events[2]).toEqual({
			type: "tool-end",
			toolCallId: "c1",
			name: "Read",
			input: {},
		});
	});

	test("reads usage from metadata.tanstack", () => {
		const events = feed(newTranslator(), [
			session,
			{
				type: "RUN_FINISHED",
				metadata: {
					tanstack: { usage: { promptTokens: 5, completionTokens: 6 } },
				},
			},
		]);
		expect(events.at(-1)).toEqual({
			type: "finished",
			usage: { inputTokens: 5, outputTokens: 6 },
		});
	});

	test("falls back to the raw result usage", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "result",
			subtype: "success",
			is_error: false,
			usage: {
				input_tokens: 10,
				cache_read_input_tokens: 90,
				output_tokens: 7,
			},
			total_cost_usd: 0.5,
		});
		const events = feed(translator, [session, { type: "RUN_FINISHED" }]);
		expect(events.at(-1)).toEqual({
			type: "finished",
			usage: {
				inputTokens: 100,
				outputTokens: 7,
				cacheReadTokens: 90,
				cacheWriteTokens: 0,
				costUsd: 0.5,
			},
		});
	});

	test("sends the usage so far after each Claude Code model call", () => {
		const t = newTranslator();
		// What a call says at its start: the input, and the output so far.
		const startUsage = {
			input_tokens: 10,
			cache_read_input_tokens: 100,
			cache_creation_input_tokens: 5,
			cache_creation: {
				ephemeral_5m_input_tokens: 0,
				ephemeral_1h_input_tokens: 5,
			},
			output_tokens: 1,
		};
		const started = (id: string, parent: string | null = null) => ({
			type: "stream_event",
			parent_tool_use_id: parent,
			event: { type: "message_start", message: { id, usage: startUsage } },
		});
		const assistant = (id: string) => ({
			type: "assistant",
			message: { id, usage: startUsage },
		});
		// The final output count; no id, and no cache split.
		const delta = (output: number, parent: string | null = null) => ({
			type: "stream_event",
			parent_tool_use_id: parent,
			event: {
				type: "message_delta",
				usage: {
					...startUsage,
					cache_creation: undefined,
					output_tokens: output,
				},
			},
		});
		const call = (output: number, calls = 1): AgentEvent => ({
			type: "usage",
			usage: {
				inputTokens: 115 * calls,
				outputTokens: output,
				cacheReadTokens: 100 * calls,
				cacheWriteTokens: 5 * calls,
				cacheWrite1hTokens: 5 * calls,
			},
		});
		const text = { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "a" };
		const said: AgentEvent = { type: "text", messageId: "m", delta: "a" };

		// Before the session id: held, like every other event.
		t.observeSdk(started("call-1"));
		expect(t.push(text)).toEqual([]);
		expect(t.push(session).at(-1)).toEqual(call(1));
		// The assistant messages of a call repeat its usage: no new event.
		t.observeSdk(assistant("call-1"));
		t.observeSdk(assistant("call-1"));
		expect(t.push(text)).toEqual([said]);
		// The delta has the final output count, and keeps the cache split.
		t.observeSdk(delta(40));
		expect(t.push(text)).toEqual([said, call(40)]);
		// A subagent's call streams apart from the main agent's.
		t.observeSdk(started("call-2"));
		t.observeSdk(started("sub-1", "task-1"));
		t.observeSdk(delta(7, "task-1"));
		t.observeSdk(delta(3));
		expect(t.push(text)).toEqual([said, call(50, 3)]);
	});

	test("holds events that arrive before the session id", () => {
		const translator = newTranslator();
		expect(
			translator.push({
				type: "TEXT_MESSAGE_CONTENT",
				messageId: "m",
				delta: "a",
			}),
		).toEqual([]);
		expect(translator.push(session)).toEqual([
			{ type: "session", sessionId: "s-1", model: "claude-haiku-4-5" },
			{ type: "text", messageId: "m", delta: "a" },
		]);
	});

	test("emits one session event and ignores other custom events", () => {
		const events = feed(newTranslator(), [
			session,
			{ ...session, value: { sessionId: "s-2" } },
			{ type: "CUSTOM", name: "file.changed", value: { diff: "" } },
			runFinished,
		]);
		expect(events.filter((e) => e.type === "session")).toHaveLength(1);
		expect(events).toHaveLength(2);
	});

	test("ignores malformed chunks", () => {
		const translator = newTranslator();
		expect(translator.push(null)).toEqual([]);
		expect(translator.push("text")).toEqual([]);
		expect(translator.push({ type: "TEXT_MESSAGE_CONTENT" })).toEqual([]);
		expect(translator.push({ type: "TOOL_CALL_START" })).toEqual([]);
	});

	test("reports a fallback session when the harness fails before init", () => {
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const events = feed(newTranslator(), [
				{
					type: "RUN_ERROR",
					message: "Agent process exited with code 1: unknown option",
				},
			]);
			expect(events).toEqual([
				{ type: "session", sessionId: "fallback" },
				{
					type: "error",
					kind: "harness",
					message:
						"Claude Code stopped with an error. Night Shift saved the details. Try again.",
				},
			]);
		} finally {
			logged.mockRestore();
		}
	});

	test("a harness program that does not start says to install it; its output goes to the log", () => {
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const text =
				"Agent process exited with code 1: Error: spawn /nonexistent/claude ENOENT\n    at ChildProcess._handle.onexit";
			const events = feed(newTranslator(), [
				{ type: "RUN_ERROR", message: text },
			]);
			expect(events.at(-1)).toEqual({
				type: "error",
				kind: "harness",
				message:
					"Claude Code did not start. Check that it is installed on this computer.",
			});
			expect(String(logged.mock.calls[0]?.[1])).toContain("ENOENT");
		} finally {
			logged.mockRestore();
		}
	});

	test("a crash of the harness program still sorts a usage limit by its output", () => {
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const events = feed(newTranslator(), [
				{
					type: "RUN_ERROR",
					message:
						"Agent process exited with code 1: Claude AI usage limit reached",
				},
			]);
			expect(events.at(-1)).toMatchObject({
				type: "error",
				kind: "usage-limit",
				message: "Claude Code reached its usage limit.",
			});
		} finally {
			logged.mockRestore();
		}
	});

	test("an abort wins over every other outcome", () => {
		const events = feed(newTranslator(), [session, runFinished], {
			aborted: true,
		});
		expect(events.at(-1)).toEqual({
			type: "error",
			kind: "aborted",
			message: "The session was aborted",
		});
	});

	test("a thrown stream ends with a harness error in plain words; its details go to the log", () => {
		const logged = spyOn(console, "error").mockImplementation(() => {});
		try {
			const boom = new Error("boom");
			const events = feed(newTranslator(), [session], {
				aborted: false,
				thrown: boom,
			});
			expect(events.at(-1)).toEqual({
				type: "error",
				kind: "harness",
				message:
					"Claude Code stopped with an error. Night Shift saved the details. Try again.",
			});
			expect(logged).toHaveBeenCalledWith(
				"[agents] the Claude Code session failed:",
				boom,
			);
		} finally {
			logged.mockRestore();
		}
	});

	test("a thrown refusal keeps its words: Night Shift wrote them for the person", () => {
		const events = feed(newTranslator(), [session], {
			aborted: false,
			thrown: new Refusal(
				"invalid",
				"Goose needs the secret GOOSE_API_KEY, but it is not saved.",
			),
		});
		expect(events.at(-1)).toEqual({
			type: "error",
			kind: "harness",
			message: "Goose needs the secret GOOSE_API_KEY, but it is not saved.",
		});
	});

	test("a stream without a result ends with a harness error", () => {
		const events = feed(newTranslator(), [session]);
		expect(events.at(-1)).toMatchObject({ type: "error", kind: "harness" });
	});

	test("a failed result wins over RUN_FINISHED", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "Not logged in · Please run /login",
		});
		const events = feed(translator, [session, runFinished]);
		expect(events.at(-1)).toEqual({
			type: "error",
			kind: "harness",
			message: "Not logged in · Please run /login",
		});
	});

	test("max turns is a normal finish, at the turn limit", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "result",
			subtype: "error_max_turns",
			is_error: true,
		});
		const events = feed(translator, [
			session,
			{ ...runFinished, finishReason: "length" },
		]);
		expect(events.at(-1)).toMatchObject({ type: "finished", limit: "turns" });
	});

	test("the budget the session set is a normal finish, at the budget", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "result",
			subtype: "error_max_budget_usd",
			is_error: true,
			total_cost_usd: 1.02,
			usage: { input_tokens: 10, output_tokens: 5 },
		});
		const events = feed(translator, [
			session,
			{
				type: "RUN_ERROR",
				message: "Claude Code run failed: error_max_budget_usd",
			},
		]);
		expect(events.at(-1)).toMatchObject({
			type: "finished",
			limit: "budget",
			usage: { costUsd: 1.02 },
		});
	});

	test("maps an assistant usage-limit error with its reset time", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "assistant",
			error: "rate_limit",
			api_error: "usage_limit_reached",
			api_error_params: {
				rate_limit_info: {
					status: "rejected",
					resetsAt: 1_760_000_000,
					rateLimitType: "five_hour",
				},
			},
			message: {
				content: [{ type: "text", text: "You've hit your limit · resets 3pm" }],
			},
		});
		translator.observeSdk({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "You've hit your limit · resets 3pm",
		});
		const events = feed(translator, [session, runFinished]);
		expect(events.at(-1)).toEqual({
			type: "error",
			kind: "usage-limit",
			message: "You've hit your limit · resets 3pm",
			resetAt: 1_760_000_000_000,
		});
	});

	test("takes the reset time from a rejected rate_limit_event", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "rate_limit_event",
			rate_limit_info: { status: "rejected", resetsAt: 1_760_000_100 },
		});
		translator.observeSdk({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "Request failed",
		});
		const events = feed(translator, [session, runFinished]);
		expect(events.at(-1)).toEqual({
			type: "error",
			kind: "usage-limit",
			message: "Request failed",
			resetAt: 1_760_000_100_000,
		});
	});

	test("an allowed rate_limit_event does not fail a finished session", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "rate_limit_event",
			rate_limit_info: { status: "allowed_warning", resetsAt: 1_760_000_100 },
		});
		expect(feed(translator, [session, runFinished]).at(-1)?.type).toBe(
			"finished",
		);
	});

	test("parses the legacy usage-limit text", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "Claude AI usage limit reached|1760000000",
		});
		const events = feed(translator, [session, runFinished]);
		expect(events.at(-1)).toEqual({
			type: "error",
			kind: "usage-limit",
			message: "Claude AI usage limit reached|1760000000",
			resetAt: 1_760_000_000_000,
		});
	});

	test("a usage-limit RUN_ERROR without a reset time", () => {
		const events = feed(newTranslator(), [
			session,
			{ type: "RUN_ERROR", message: "5-hour limit reached ∙ resets 3pm" },
		]);
		expect(events.at(-1)).toEqual({
			type: "error",
			kind: "usage-limit",
			message: "5-hour limit reached ∙ resets 3pm",
		});
	});

	test("emits nothing after finish", () => {
		const translator = newTranslator();
		feed(translator, [session, runFinished]);
		expect(
			translator.push({
				type: "TEXT_MESSAGE_CONTENT",
				messageId: "m",
				delta: "x",
			}),
		).toEqual([]);
		expect(translator.finish({ aborted: false })).toEqual([]);
	});
});

describe("tool results", () => {
	const call = (result: Record<string, unknown>) => [
		{ type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "Bash" },
		{ type: "TOOL_CALL_END", toolCallId: "c1", input: { command: "ls" } },
		{ type: "TOOL_CALL_RESULT", toolCallId: "c1", ...result },
	];
	const result = (events: AgentEvent[]) =>
		events.find((e) => e.type === "tool-result");

	test.each([
		["the chunk", { content: "No such file", state: "output-error" }],
		[
			"its metadata",
			{
				content: "No such file",
				metadata: { tanstack: { state: "output-error" } },
			},
		],
	])("an error result in %s is marked as an error", (_name, chunk) => {
		const events = feed(newTranslator(), [
			session,
			...call(chunk),
			runFinished,
		]);
		expect(result(events)).toEqual({
			type: "tool-result",
			toolCallId: "c1",
			content: "No such file",
			isError: true,
		});
	});

	test("a successful result has no error mark", () => {
		const events = feed(newTranslator(), [
			session,
			...call({ content: "a.txt" }),
			runFinished,
		]);
		expect(result(events)).toEqual({
			type: "tool-result",
			toolCallId: "c1",
			content: "a.txt",
		});
	});
});

describe("step reports", () => {
	const reporting = () =>
		createTranslator({
			fallbackSessionId: "fallback",
			stepReport: true,
			profile: CLAUDE_CODE_PROFILE,
		});

	const reportCall = (
		input: unknown,
		result: Record<string, unknown> = { content: "Step report recorded." },
		name = "report_step",
	) => [
		{ type: "TOOL_CALL_START", toolCallId: "r1", toolCallName: name },
		{ type: "TOOL_CALL_ARGS", toolCallId: "r1", delta: "{}" },
		{ type: "TOOL_CALL_END", toolCallId: "r1", toolCallName: name, input },
		{ type: "TOOL_CALL_RESULT", toolCallId: "r1", messageId: "x", ...result },
	];

	test("a report tool call becomes one report event, without tool events", () => {
		const events = feed(reporting(), [
			session,
			{ type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "Read" },
			{ type: "TOOL_CALL_END", toolCallId: "c1", input: {} },
			{ type: "TOOL_CALL_RESULT", toolCallId: "c1", content: "hi" },
			...reportCall({ outcome: "pass", summary: " All good. " }),
			runFinished,
		]);
		expect(events.map((e) => e.type)).toEqual([
			"session",
			"tool-start",
			"tool-end",
			"tool-result",
			"report",
			"finished",
		]);
		expect(events[4]).toEqual({
			type: "report",
			outcome: "pass",
			summary: "All good.",
		});
	});

	test("accepts the prefixed MCP name and the input from metadata", () => {
		const translator = reporting();
		const events = feed(translator, [
			session,
			{
				type: "TOOL_CALL_START",
				toolCallId: "r1",
				toolCallName: "mcp__tanstack__report_step",
			},
			{
				type: "TOOL_CALL_END",
				toolCallId: "r1",
				metadata: {
					tanstack: { input: { outcome: "needs-input", summary: "Which?" } },
				},
			},
			{ type: "TOOL_CALL_RESULT", toolCallId: "r1", content: "ok" },
			runFinished,
		]);
		expect(events[1]).toEqual({
			type: "report",
			outcome: "needs-input",
			summary: "Which?",
		});
	});

	test.each([
		["invalid input", { outcome: "maybe", summary: "x" }, { content: "ok" }],
		["missing summary", { outcome: "pass" }, { content: "ok" }],
		[
			"a denied call",
			{ outcome: "pass", summary: "x" },
			{ content: "denied", state: "output-error" },
		],
	])("shows the call instead of a report for %s", (_name, input, result) => {
		const events = feed(reporting(), [
			session,
			...reportCall(input, result),
			runFinished,
		]);
		expect(events.map((e) => e.type)).toEqual([
			"session",
			"tool-start",
			"tool-end",
			"tool-result",
			"finished",
		]);
	});

	test("emits nothing for an interrupted call", () => {
		const events = feed(reporting(), [
			session,
			...reportCall(
				{ outcome: "pass", summary: "x" },
				{ content: '{"status":"interrupted"}' },
			),
			runFinished,
		]);
		expect(events.map((e) => e.type)).toEqual(["session", "finished"]);
	});

	test("the agent can report again after a rejected call", () => {
		const events = feed(reporting(), [
			session,
			...reportCall(
				{ outcome: "nope" },
				{ content: "x", state: "output-error" },
			),
			...reportCall({ outcome: "fail", summary: "Tests fail." }),
			runFinished,
		]);
		expect(events.filter((e) => e.type === "report")).toEqual([
			{ type: "report", outcome: "fail", summary: "Tests fail." },
		]);
	});

	describe("a valid report whose delivery failed", () => {
		/** What Claude Code said when the bridge on its port was another session's. */
		const LOST =
			'MCP server "tanstack" rejected the Authorization header in its config (update it, then run /mcp to reconnect)';
		const valid = { outcome: "pass", summary: "Fixed it." };

		test.each([
			["a lost bridge", { content: LOST, state: "output-error" }],
			[
				"a failed call in metadata",
				{
					content: "Tool execution failed: fetch failed",
					metadata: { tanstack: { state: "output-error" } },
				},
			],
			[
				"a closed connection",
				{
					content: "MCP error -32000: Connection closed",
					state: "output-error",
				},
			],
			["an empty error", { content: "", state: "output-error" }],
		])("counts after %s, and shows the failed call", (_name, result) => {
			const events = feed(reporting(), [
				session,
				...reportCall(valid, result),
				runFinished,
			]);
			expect(events.slice(1)).toEqual([
				{ type: "tool-start", toolCallId: "r1", name: "report_step" },
				{
					type: "tool-end",
					toolCallId: "r1",
					name: "report_step",
					input: valid,
				},
				{
					type: "tool-result",
					toolCallId: "r1",
					content: result.content,
					isError: true,
				},
				{ type: "report", outcome: "pass", summary: "Fixed it." },
				expect.objectContaining({ type: "finished" }),
			]);
		});

		test("counts with the input from the raw messages (OpenCode)", () => {
			const t = createTranslator({
				fallbackSessionId: "f",
				stepReport: true,
				profile: {
					label: "Other",
					sessionEvent: "other.session-id",
					createObserver: () => (signals, raw) => ({
						...signals,
						...(raw as SdkSignals),
					}),
					toolInputFromSignals: true,
				},
			});
			t.push({
				type: "CUSTOM",
				name: "other.session-id",
				value: { sessionId: "s" },
			});
			t.push({
				type: "TOOL_CALL_START",
				toolCallId: "r1",
				toolCallName: "report_step",
			});
			t.push({ type: "TOOL_CALL_END", toolCallId: "r1", input: {} });
			t.observeSdk({ toolInputs: { r1: valid } });
			expect(
				t
					.push({
						type: "TOOL_CALL_RESULT",
						toolCallId: "r1",
						content: "Unable to connect",
						state: "output-error",
					})
					.filter((e) => e.type === "report"),
			).toEqual([{ type: "report", outcome: "pass", summary: "Fixed it." }]);
		});

		test.each([
			[
				"Night Shift's own check",
				'Tool execution failed: Invalid report. Expected { outcome: "pass" | "fail" | "needs-input", summary: string }.',
			],
			[
				"the harness's input check",
				"InputValidationError: report_step failed due to the following issue",
			],
			["invalid params", "MCP error -32602: Invalid params"],
			[
				"a deny rule",
				"Permission to use mcp__tanstack__report_step has been denied.",
			],
			[
				"a person who said no",
				"The user doesn't want to proceed with this tool use. The tool use was rejected.",
			],
			[
				"an OpenCode rule",
				"The user has specified a rule which prevents you from using this specific tool call.",
			],
			[
				"an OpenCode rejection",
				"The user rejected permission to use this specific tool call.",
			],
		])("does not count when refused by %s", (_name, content) => {
			const events = feed(reporting(), [
				session,
				...reportCall(valid, { content, state: "output-error" }),
				runFinished,
			]);
			expect(events.map((e) => e.type)).toEqual([
				"session",
				"tool-start",
				"tool-end",
				"tool-result",
				"finished",
			]);
			expect(events[3]).toMatchObject({ isError: true });
		});

		test("an invalid report with an error result does not count", () => {
			const events = feed(reporting(), [
				session,
				...reportCall(
					{ outcome: "maybe", summary: "x" },
					{ content: LOST, state: "output-error" },
				),
				runFinished,
			]);
			expect(events.map((e) => e.type)).toEqual([
				"session",
				"tool-start",
				"tool-end",
				"tool-result",
				"finished",
			]);
		});

		test("a later valid report wins over a failed one, and the other way round", () => {
			const call = (
				id: string,
				input: unknown,
				result: Record<string, unknown>,
			) =>
				reportCall(input, result).map((chunk) => ({
					...chunk,
					toolCallId: id,
				}));
			const failedFirst = feed(reporting(), [
				session,
				...call(
					"r1",
					{ outcome: "fail", summary: "a" },
					{
						content: LOST,
						state: "output-error",
					},
				),
				...call("r2", { outcome: "pass", summary: "b" }, { content: "ok" }),
				runFinished,
			]);
			expect(failedFirst.filter((e) => e.type === "report")).toEqual([
				{ type: "report", outcome: "fail", summary: "a" },
				{ type: "report", outcome: "pass", summary: "b" },
			]);
			const failedLast = feed(reporting(), [
				session,
				...call("r1", { outcome: "pass", summary: "a" }, { content: "ok" }),
				...call(
					"r2",
					{ outcome: "fail", summary: "b" },
					{
						content: LOST,
						state: "output-error",
					},
				),
				runFinished,
			]);
			expect(failedLast.filter((e) => e.type === "report").at(-1)).toEqual({
				type: "report",
				outcome: "fail",
				summary: "b",
			});
		});
	});

	test("without stepReport the tool call is an ordinary tool", () => {
		const events = feed(newTranslator(), [
			session,
			...reportCall({ outcome: "pass", summary: "x" }),
			runFinished,
		]);
		expect(events.map((e) => e.type)).toEqual([
			"session",
			"tool-start",
			"tool-end",
			"tool-result",
			"finished",
		]);
	});

	test("a text report in the result becomes a report before finished", () => {
		const translator = reporting();
		translator.observeSdk({
			type: "result",
			subtype: "success",
			is_error: false,
			result:
				'Done.\nNIGHTSHIFT-REPORT: {"outcome": "fail", "summary": "No pelican."}',
		});
		const events = feed(translator, [session, runFinished]);
		expect(events.slice(1)).toEqual([
			{ type: "report", outcome: "fail", summary: "No pelican." },
			expect.objectContaining({ type: "finished" }),
		]);
	});

	test("a text report counts after a tool report", () => {
		const translator = reporting();
		translator.observeSdk({
			type: "result",
			subtype: "success",
			result: 'NIGHTSHIFT-REPORT: {"outcome": "pass", "summary": "b"}',
		});
		const events = feed(translator, [
			session,
			...reportCall({ outcome: "fail", summary: "a" }),
			runFinished,
		]);
		expect(events.filter((e) => e.type === "report").at(-1)).toEqual({
			type: "report",
			outcome: "pass",
			summary: "b",
		});
	});

	test("no text report when aborted or when stepReport is off", () => {
		const result = {
			type: "result",
			subtype: "success",
			result: 'NIGHTSHIFT-REPORT: {"outcome": "pass", "summary": "x"}',
		};
		const aborted = reporting();
		aborted.observeSdk(result);
		const off = newTranslator();
		off.observeSdk(result);
		expect(
			feed(aborted, [session, runFinished], { aborted: true }).map(
				(e) => e.type,
			),
		).toEqual(["session", "error"]);
		expect(feed(off, [session, runFinished]).map((e) => e.type)).toEqual([
			"session",
			"finished",
		]);
	});

	test("a session without a report emits no report", () => {
		const events = feed(reporting(), [session, runFinished]);
		expect(events.map((e) => e.type)).toEqual(["session", "finished"]);
	});

	describe("with a spec", () => {
		const reviewing = () =>
			createTranslator({
				fallbackSessionId: "fallback",
				profile: CLAUDE_CODE_PROFILE,
				stepReport: {
					outcomes: [{ name: "approved" }, { name: "changes-requested" }],
					output: { type: "object" },
				},
			});

		test("a custom outcome with data becomes a report with data", () => {
			const events = feed(reviewing(), [
				session,
				...reportCall({
					outcome: "changes-requested",
					summary: "Two issues.",
					data: { issues: ["a", "b"] },
				}),
				runFinished,
			]);
			expect(events.map((e) => e.type)).toEqual([
				"session",
				"report",
				"finished",
			]);
			expect(events[1]).toEqual({
				type: "report",
				outcome: "changes-requested",
				summary: "Two issues.",
				data: { issues: ["a", "b"] },
			});
		});

		test.each([
			["a default outcome", { outcome: "pass", summary: "x", data: {} }],
			["missing data", { outcome: "approved", summary: "x" }],
		])("shows the call instead of a report for %s", (_name, input) => {
			const events = feed(reviewing(), [
				session,
				...reportCall(input),
				runFinished,
			]);
			expect(events.map((e) => e.type)).toEqual([
				"session",
				"tool-start",
				"tool-end",
				"tool-result",
				"finished",
			]);
		});

		test("a text report with a custom outcome and data", () => {
			const translator = reviewing();
			translator.observeSdk({
				type: "result",
				subtype: "success",
				result:
					'NIGHTSHIFT-REPORT: {"outcome": "approved", "summary": "Fine.", "data": {"issues": []}}',
			});
			expect(feed(translator, [session, runFinished]).slice(1)).toEqual([
				{
					type: "report",
					outcome: "approved",
					summary: "Fine.",
					data: { issues: [] },
				},
				expect.objectContaining({ type: "finished" }),
			]);
		});
	});
});

describe("observeSdkMessage", () => {
	test("ignores unrelated messages", () => {
		const signals = {};
		expect(
			observeSdkMessage(signals, { type: "system", subtype: "init" }),
		).toBe(signals);
		expect(observeSdkMessage(signals, "not json")).toBe(signals);
		expect(
			observeSdkMessage(signals, {
				type: "assistant",
				message: { content: [] },
			}),
		).toBe(signals);
	});

	test("a non-success subtype is a failure with the joined errors", () => {
		expect(
			observeSdkMessage(
				{},
				{
					type: "result",
					subtype: "error_during_execution",
					errors: ["a", "b"],
				},
			).resultError,
		).toBe("a; b");
	});
});

describe("usage-limit text", () => {
	test.each([
		["Claude AI usage limit reached|1760000000", true],
		["You've hit your limit · resets 3pm (Europe/Amsterdam)", true],
		["You've hit your weekly limit", true],
		["5-hour limit reached ∙ resets 3pm", true],
		["Not logged in", false],
		[
			'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed the rate limit for your organization"}}',
			true,
		],
		["HTTP 429: Too Many Requests (https://api.github.com/graphql)", true],
		["You have exceeded your quota", true],
		["API rate limit exceeded for user ID 123456.", true],
		[
			"You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
			false,
		],
	])("%s", (text, expected) => {
		expect(isUsageLimitText(text)).toBe(expected);
	});

	test("legacy reset accepts seconds and milliseconds", () => {
		expect(parseLegacyResetAt("x|1760000000")).toBe(1_760_000_000_000);
		expect(parseLegacyResetAt("x|1760000000123")).toBe(1_760_000_000_123);
		expect(parseLegacyResetAt("no reset")).toBeUndefined();
	});
});

describe("network text", () => {
	test.each([
		"API Error: Connection error.",
		"API Error (Request timed out.)",
		'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Internal server error"}}',
		'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
		"error connecting to api.github.com",
		'Post "https://api.github.com/graphql": dial tcp: lookup api.github.com: no such host',
		"fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com",
		"getaddrinfo ENOTFOUND api.anthropic.com",
		"getaddrinfo EAI_AGAIN api.anthropic.com",
		"connect ECONNREFUSED 127.0.0.1:443",
		"read ECONNRESET",
		"Connection reset by peer",
		"connection refused",
		"ssh: connect to host github.com port 22: Operation timed out",
		"net/http: TLS handshake timeout",
		'Post "https://api.github.com/graphql": unexpected EOF',
		"error: RPC failed; curl 56 LibreSSL SSL_read: Connection reset by peer; fatal: the remote end hung up unexpectedly",
		"HTTP 502: Bad Gateway (https://api.github.com/graphql)",
		"HTTP 503: Service Unavailable",
		"HTTP 504: Gateway Timeout",
		"Network is unreachable",
		"TypeError: fetch failed",
		"socket hang up",
		"You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
	])("network: %s", (text) => {
		expect(failureKind(text)).toBe("network");
		expect(isNetworkText(text)).toBe(true);
		expect(isUsageLimitText(text)).toBe(false);
	});

	test.each([
		"Not logged in · Please run /login",
		"Invalid API key · Please run /login",
		"HTTP 404: Not Found (https://api.github.com/repos/x/y)",
		"HTTP 401: Bad credentials",
		"Claude Code run failed: error_during_execution",
	])("neither: %s", (text) => {
		expect(failureKind(text)).toBeUndefined();
	});

	test("a primary rate limit stays a usage limit, also next to a 5xx word", () => {
		expect(
			failureKind(
				'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}',
			),
		).toBe("usage-limit");
		expect(failureKind("HTTP 429: Too Many Requests")).toBe("usage-limit");
		expect(failureKind("service unavailable: quota exhausted")).toBe(
			"usage-limit",
		);
	});
});

describe("network errors", () => {
	const newTranslator = () =>
		createTranslator({
			fallbackSessionId: "fallback",
			profile: CLAUDE_CODE_PROFILE,
		});

	test("a failed result with an API connection error", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "API Error: Connection error.",
		});
		expect(feed(translator, [session, runFinished]).at(-1)).toEqual({
			type: "error",
			kind: "network",
			message: "API Error: Connection error.",
		});
	});

	test("a RUN_ERROR with a socket error", () => {
		const events = feed(newTranslator(), [
			session,
			{
				type: "RUN_ERROR",
				message: "getaddrinfo ENOTFOUND api.anthropic.com",
			},
		]);
		expect(events.at(-1)).toEqual({
			type: "error",
			kind: "network",
			message: "getaddrinfo ENOTFOUND api.anthropic.com",
		});
	});

	test("a thrown stream with a refused connection", () => {
		const events = feed(newTranslator(), [session], {
			aborted: false,
			thrown: new Error("connect ECONNREFUSED 127.0.0.1:443"),
		});
		expect(events.at(-1)).toMatchObject({ type: "error", kind: "network" });
	});

	test("an assistant server_error marks a plain failure as network", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "assistant",
			error: "server_error",
			message: {
				content: [
					{
						type: "text",
						text: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
					},
				],
			},
		});
		translator.observeSdk({
			type: "result",
			subtype: "error_during_execution",
			is_error: true,
			errors: ["Claude Code process ended"],
		});
		expect(feed(translator, [session, runFinished]).at(-1)).toEqual({
			type: "error",
			kind: "network",
			message: "Claude Code process ended",
		});
	});

	test("an assistant network error without a result", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "assistant",
			error: "unknown",
			message: {
				content: [{ type: "text", text: "API Error: Request timed out." }],
			},
		});
		expect(feed(translator, [session]).at(-1)).toEqual({
			type: "error",
			kind: "network",
			message: "API Error: Request timed out.",
		});
	});

	test("an assistant API error that recovered does not fail the session", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "assistant",
			error: "server_error",
			message: { content: [{ type: "text", text: "API Error: 500" }] },
		});
		expect(feed(translator, [session, runFinished]).at(-1)?.type).toBe(
			"finished",
		);
	});

	test("an assistant error that is not the network is ignored", () => {
		expect(
			observeSdkMessage(
				{},
				{
					type: "assistant",
					error: "authentication_failed",
					message: { content: [{ type: "text", text: "Invalid API key" }] },
				},
			),
		).toEqual({});
	});

	test("a rejected rate_limit_event wins over a network text", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "rate_limit_event",
			rate_limit_info: { status: "rejected", resetsAt: 1_760_000_100 },
		});
		translator.observeSdk({
			type: "result",
			subtype: "success",
			is_error: true,
			result: "API Error: Connection error.",
		});
		expect(feed(translator, [session, runFinished]).at(-1)).toMatchObject({
			kind: "usage-limit",
			resetAt: 1_760_000_100_000,
		});
	});

	test("a primary rate limit in the result is a usage limit", () => {
		const translator = newTranslator();
		translator.observeSdk({
			type: "result",
			subtype: "success",
			is_error: true,
			result:
				'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}',
		});
		expect(feed(translator, [session, runFinished]).at(-1)).toMatchObject({
			type: "error",
			kind: "usage-limit",
		});
	});
});

describe("harness profiles", () => {
	/** A profile whose raw messages are SdkSignals patches. */
	const profile = (extra: Partial<HarnessProfile> = {}): HarnessProfile => ({
		label: "Other",
		sessionEvent: "other.session-id",
		createObserver: () => (signals, raw) => ({
			...signals,
			...(raw as SdkSignals),
		}),
		...extra,
	});

	test("its own session event, and its label in errors", () => {
		const t = createTranslator({
			fallbackSessionId: "f",
			profile: profile(),
		});
		expect(t.push(session)).toEqual([]);
		expect(
			t.push({
				type: "CUSTOM",
				name: "other.session-id",
				value: { sessionId: "o-1" },
			}),
		).toEqual([{ type: "session", sessionId: "o-1" }]);
		expect(t.finish({ aborted: false }).at(-1)).toEqual({
			type: "error",
			kind: "harness",
			message: "Other ended without a result",
		});
	});

	test("a known session id goes out with the first chunk", () => {
		const t = createTranslator({
			fallbackSessionId: "f",
			knownSessionId: "k-1",
			profile: profile(),
		});
		expect(
			t.push({ type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "Hi" }),
		).toEqual([
			{ type: "session", sessionId: "k-1" },
			{ type: "text", messageId: "m", delta: "Hi" },
		]);
	});

	test("settles on `done` and finishes with the raw usage", () => {
		const t = createTranslator({
			fallbackSessionId: "f",
			profile: profile({ usageFromSignals: true }),
		});
		expect(t.settled()).toBe(false);
		t.observeSdk({
			done: true,
			resultUsage: { inputTokens: 3, outputTokens: 2, costUsd: 0.5 },
		});
		expect(t.settled()).toBe(true);
		expect(t.finish({ aborted: false }).at(-1)).toEqual({
			type: "finished",
			usage: { inputTokens: 3, outputTokens: 2, costUsd: 0.5 },
		});
	});

	test("hidden text ids are not assistant text", () => {
		const t = createTranslator({ fallbackSessionId: "f", profile: profile() });
		t.observeSdk({ hiddenTextIds: new Set(["echo"]) });
		expect(
			t.push({ type: "TEXT_MESSAGE_CONTENT", messageId: "echo", delta: "x" }),
		).toEqual([]);
	});

	test("tool inputs from the raw messages, emitted with the result", () => {
		const t = createTranslator({
			fallbackSessionId: "f",
			stepReport: true,
			profile: profile({ toolInputFromSignals: true }),
		});
		t.push({
			type: "CUSTOM",
			name: "other.session-id",
			value: { sessionId: "s" },
		});
		const call = (id: string, name: string) => [
			{ type: "TOOL_CALL_START", toolCallId: id, toolCallName: name },
			{ type: "TOOL_CALL_END", toolCallId: id, toolCallName: name, input: {} },
		];
		expect(call("c1", "read").flatMap((c) => t.push(c))).toEqual([
			{ type: "tool-start", toolCallId: "c1", name: "read" },
		]);
		t.observeSdk({ toolInputs: { c1: { path: "a" } } });
		expect(
			t.push({ type: "TOOL_CALL_RESULT", toolCallId: "c1", content: "ok" }),
		).toEqual([
			{
				type: "tool-end",
				toolCallId: "c1",
				name: "read",
				input: { path: "a" },
			},
			{ type: "tool-result", toolCallId: "c1", content: "ok" },
		]);
		// The report tool: its first input is empty, the real one comes later.
		for (const c of call("c2", "report_step")) t.push(c);
		t.observeSdk({
			toolInputs: { c2: { outcome: "pass", summary: "Fine." } },
		});
		expect(
			t.push({ type: "TOOL_CALL_RESULT", toolCallId: "c2", content: "ok" }),
		).toEqual([{ type: "report", outcome: "pass", summary: "Fine." }]);
		// A call without a result still shows, before the terminal event.
		for (const c of call("c3", "bash")) t.push(c);
		expect(t.finish({ aborted: true })).toEqual([
			{ type: "tool-end", toolCallId: "c3", name: "bash", input: {} },
			{ type: "error", kind: "aborted", message: "The session was aborted" },
		]);
	});

	test("a raw tool input wins over the input of TOOL_CALL_END", () => {
		const t = createTranslator({ fallbackSessionId: "f", profile: profile() });
		t.push({
			type: "CUSTOM",
			name: "other.session-id",
			value: { sessionId: "s" },
		});
		t.observeSdk({ toolInputs: { c1: { items: ["a"] } } });
		expect(
			[
				{ type: "TOOL_CALL_START", toolCallId: "c1", toolCallName: "x" },
				{
					type: "TOOL_CALL_END",
					toolCallId: "c1",
					toolCallName: "x",
					input: {},
				},
			].flatMap((c) => t.push(c)),
		).toEqual([
			{ type: "tool-start", toolCallId: "c1", name: "x" },
			{
				type: "tool-end",
				toolCallId: "c1",
				name: "x",
				input: { items: ["a"] },
			},
		]);
	});

	test("each plan replaces the list of one todo_list call", () => {
		const t = createTranslator({
			fallbackSessionId: "f",
			profile: profile({ planEvent: "other.plan" }),
		});
		const plan = (status: string) => ({
			type: "CUSTOM",
			name: "other.plan",
			value: { entries: [{ content: "Fix", priority: "high", status }] },
		});
		// A plan before the session id waits for it.
		expect(t.push(plan("pending"))).toEqual([]);
		const items = (status: string) => ({
			items: [{ content: "Fix", priority: "high", status }],
		});
		expect(
			t.push({
				type: "CUSTOM",
				name: "other.session-id",
				value: { sessionId: "s" },
			}),
		).toEqual([
			{ type: "session", sessionId: "s" },
			{ type: "tool-start", toolCallId: "plan", name: "todo_list" },
			{
				type: "tool-end",
				toolCallId: "plan",
				name: "todo_list",
				input: items("pending"),
			},
			{
				type: "tool-result",
				toolCallId: "plan",
				content: JSON.stringify(items("pending")),
			},
		]);
		expect(t.push(plan("completed"))).toEqual([
			{
				type: "tool-end",
				toolCallId: "plan",
				name: "todo_list",
				input: items("completed"),
			},
			{
				type: "tool-result",
				toolCallId: "plan",
				content: JSON.stringify(items("completed")),
			},
		]);
		// The same plan again changes nothing.
		expect(t.push(plan("completed"))).toEqual([]);
	});

	test("a plan event is nothing for a profile without one", () => {
		const t = createTranslator({ fallbackSessionId: "f", profile: profile() });
		t.push({
			type: "CUSTOM",
			name: "other.session-id",
			value: { sessionId: "s" },
		});
		expect(
			t.push({ type: "CUSTOM", name: "other.plan", value: { entries: [] } }),
		).toEqual([]);
	});

	test("Codex: the to-do list is live, and its answer closes it", () => {
		const t = createTranslator({
			fallbackSessionId: "f",
			profile: CODEX_PROFILE,
		});
		const list = (done: boolean) => [
			{ text: "Read the code", completed: true },
			{ text: "Fix the bug", completed: done },
		];
		const todo = (type: string, done: boolean) => ({
			type,
			item: { id: "item_0", type: "todo_list", items: list(done) },
		});
		const events: AgentEvent[] = [];
		// The adapter logs each raw event before it yields its chunks.
		const raw = (event: unknown, ...chunks: unknown[]) => {
			t.observeSdk(event);
			events.push(...t.drain(), ...chunks.flatMap((c) => t.push(c)));
		};
		raw(
			{ type: "thread.started", thread_id: "th" },
			{
				type: "CUSTOM",
				name: "codex.session-id",
				value: { sessionId: "th" },
			},
		);
		raw(
			todo("item.started", false),
			{
				type: "TOOL_CALL_START",
				toolCallId: "item_0",
				toolCallName: "todo_list",
			},
			{
				type: "TOOL_CALL_END",
				toolCallId: "item_0",
				toolCallName: "todo_list",
				input: {},
			},
		);
		raw(todo("item.updated", true));
		// The same list again changes nothing.
		raw(todo("item.updated", true));
		raw(todo("item.completed", true), {
			type: "TOOL_CALL_RESULT",
			toolCallId: "item_0",
			content: JSON.stringify({ items: list(true) }),
		});
		expect(events).toEqual([
			{ type: "session", sessionId: "th" },
			{ type: "tool-start", toolCallId: "item_0", name: "todo_list" },
			{
				type: "tool-end",
				toolCallId: "item_0",
				name: "todo_list",
				input: { items: list(false) },
			},
			{
				type: "tool-end",
				toolCallId: "item_0",
				name: "todo_list",
				input: { items: list(true) },
			},
			{
				type: "tool-result",
				toolCallId: "item_0",
				content: JSON.stringify({ items: list(true) }),
			},
		]);
	});

	test("the raw cost fills in a chunk usage without one", () => {
		const t = createTranslator({
			fallbackSessionId: "f",
			profile: CLAUDE_CODE_PROFILE,
		});
		t.observeSdk({
			type: "result",
			subtype: "success",
			total_cost_usd: 0.25,
			usage: { input_tokens: 1, output_tokens: 1 },
		});
		t.push({
			type: "RUN_FINISHED",
			usage: { promptTokens: 10, completionTokens: 4 },
		});
		expect(t.finish({ aborted: false }).at(-1)).toEqual({
			type: "finished",
			usage: { inputTokens: 10, outputTokens: 4, costUsd: 0.25 },
		});
	});
});
