import { describe, expect, test } from "bun:test";
import {
	createTranslator,
	failureKind,
	type HarnessProfile,
	isNetworkText,
	isUsageLimitText,
	observeSdkMessage,
	parseLegacyResetAt,
	type SdkSignals,
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

describe("step reports", () => {
	const reporting = () =>
		createTranslator({ fallbackSessionId: "fallback", stepReport: true });

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
			"an error result",
			{ outcome: "pass", summary: "x" },
			{ content: "denied", state: "output-error" },
		],
		[
			"an error result in metadata",
			{ outcome: "pass", summary: "x" },
			{
				content: "Tool execution failed",
				metadata: { tanstack: { state: "output-error" } },
			},
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
		createTranslator({ fallbackSessionId: "fallback" });

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

	test("the raw cost fills in a chunk usage without one", () => {
		const t = createTranslator({ fallbackSessionId: "f" });
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
