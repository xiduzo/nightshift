import { describe, expect, test } from "bun:test";
import {
	createTranslator,
	isUsageLimitText,
	observeSdkMessage,
	parseLegacyResetAt,
	type Translator,
} from "./translate";
import type { AgentEvent } from "./types";

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

const newTranslator = () => createTranslator({ fallbackSessionId: "fallback" });

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
			usage: { inputTokens: 100, outputTokens: 7, costUsd: 0.5 },
		});
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
		const events = feed(newTranslator(), [
			{
				type: "RUN_ERROR",
				message: "Agent process exited with code 1: not found",
			},
		]);
		expect(events).toEqual([
			{ type: "session", sessionId: "fallback" },
			{
				type: "error",
				kind: "harness",
				message: "Agent process exited with code 1: not found",
			},
		]);
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

	test("a thrown stream ends with a harness error", () => {
		const events = feed(newTranslator(), [session], {
			aborted: false,
			thrown: new Error("boom"),
		});
		expect(events.at(-1)).toEqual({
			type: "error",
			kind: "harness",
			message: "boom",
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

	test("max turns is a normal finish", () => {
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
		expect(events.at(-1)?.type).toBe("finished");
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
	])("%s", (text, expected) => {
		expect(isUsageLimitText(text)).toBe(expected);
	});

	test("legacy reset accepts seconds and milliseconds", () => {
		expect(parseLegacyResetAt("x|1760000000")).toBe(1_760_000_000_000);
		expect(parseLegacyResetAt("x|1760000000123")).toBe(1_760_000_000_123);
		expect(parseLegacyResetAt("no reset")).toBeUndefined();
	});
});
