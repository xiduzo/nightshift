/**
 * Pure translation from the TanStack AI stream of a Claude Code session to
 * normalized AgentEvent values.
 *
 * Two inputs feed one translator:
 * - AG-UI chunks yielded by `chat()` (`push`).
 * - Raw Claude Code stream-json messages (`observeSdk`), tapped from the
 *   adapter's provider log. The AG-UI translation drops what usage-limit
 *   detection needs (`rate_limit_event`, the assistant `error` field, the
 *   result's `is_error`), so those are read from the raw messages.
 *
 * The translator enforces the stream contract: one `session` event first and
 * one terminal `finished` / `error` event last (from `finish`).
 *
 * Step reports (`stepReport` on), see `step-report.ts`:
 * - A `report_step` tool call becomes one `report` event, emitted when its
 *   successful result arrives. The call itself is harness plumbing: its
 *   `tool-start` / `tool-end` / `tool-result` events are not emitted. A call
 *   with invalid input, or one that fails or is denied, emits its tool
 *   events instead, so the transcript shows the report that did not count.
 * - A `NIGHTSHIFT-REPORT: {...}` line in the final result text becomes one
 *   `report` event just before the terminal event. The line stays in the
 *   streamed text.
 * Both channels are read in every mode; the last report counts.
 */
import {
	isReportTool,
	parseStepReport,
	parseTextReport,
	type StepReport,
} from "./step-report";
import type { AgentErrorKind, AgentEvent, AgentUsage } from "./types";

/** The AG-UI chunk shape this module reads. Every field is checked at runtime. */
export type AgUiChunk = { type: string; [key: string]: unknown };

export const SESSION_ID_EVENT = "claude-code.session-id";

type UsageLimit = { message: string; resetAt?: number };

/** What the raw Claude Code messages say about how the session ended. */
export type SdkSignals = {
	/** An assistant message reported a rate or usage limit. */
	usageLimit?: UsageLimit;
	/** Reset time of the last `rate_limit_event` with status `rejected`. */
	rejectedResetAt?: number;
	/** The result message reported a failure. */
	resultError?: string;
	/** Usage from the result message, a fallback for RUN_FINISHED usage. */
	resultUsage?: AgentUsage;
	/** The `result` text of the result message: the final assistant text. */
	resultText?: string;
};

export type FinishInput = {
	/** The caller aborted the session. Wins over every other outcome. */
	aborted: boolean;
	/** The chunk stream threw instead of ending. */
	thrown?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

/** Claude Code reports reset times in epoch seconds. Accept milliseconds too. */
export function toEpochMs(value: number): number {
	return value < 1e12 ? value * 1000 : value;
}

const USAGE_LIMIT_TEXT =
	/usage limit|hit your (?:\w+ )?limit|limit reached|out of (?:extra )?usage/i;

/** Older Claude Code versions end the message with `|<epoch seconds>`. */
const LEGACY_RESET = /\|(\d{10,13})\s*$/;

export function isUsageLimitText(text: string): boolean {
	return USAGE_LIMIT_TEXT.test(text);
}

export function parseLegacyResetAt(text: string): number | undefined {
	const match = LEGACY_RESET.exec(text);
	return match?.[1] === undefined ? undefined : toEpochMs(Number(match[1]));
}

function resetAtFromInfo(info: unknown): number | undefined {
	if (!isRecord(info)) return undefined;
	const resetsAt = asNumber(info.resetsAt);
	return resetsAt === undefined ? undefined : toEpochMs(resetsAt);
}

function assistantText(message: Record<string, unknown>): string {
	const inner = message.message;
	if (!isRecord(inner) || !Array.isArray(inner.content)) return "";
	return inner.content
		.map((block) =>
			isRecord(block) && block.type === "text"
				? (asString(block.text) ?? "")
				: "",
		)
		.join("")
		.trim();
}

function usageFromSdkResult(
	message: Record<string, unknown>,
): AgentUsage | undefined {
	const usage = message.usage;
	if (!isRecord(usage)) return undefined;
	const inputTokens =
		(asNumber(usage.input_tokens) ?? 0) +
		(asNumber(usage.cache_read_input_tokens) ?? 0) +
		(asNumber(usage.cache_creation_input_tokens) ?? 0);
	const costUsd = asNumber(message.total_cost_usd);
	return {
		inputTokens,
		outputTokens: asNumber(usage.output_tokens) ?? 0,
		...(costUsd !== undefined ? { costUsd } : {}),
	};
}

/** Fold one raw Claude Code stream-json message into the signals. Pure. */
export function observeSdkMessage(
	signals: SdkSignals,
	message: unknown,
): SdkSignals {
	if (!isRecord(message)) return signals;

	if (message.type === "rate_limit_event") {
		const info = message.rate_limit_info;
		if (!isRecord(info) || info.status !== "rejected") return signals;
		const resetAt = resetAtFromInfo(info);
		return resetAt === undefined
			? signals
			: { ...signals, rejectedResetAt: resetAt };
	}

	if (message.type === "assistant") {
		const isLimit =
			message.error === "rate_limit" ||
			message.api_error === "usage_limit_reached";
		if (!isLimit) return signals;
		const params = message.api_error_params;
		const resetAt = isRecord(params)
			? resetAtFromInfo(params.rate_limit_info)
			: undefined;
		const text = assistantText(message);
		return {
			...signals,
			usageLimit: {
				message: text || "Claude Code usage limit reached",
				...(resetAt !== undefined
					? { resetAt }
					: parseLegacyResetAt(text) !== undefined
						? { resetAt: parseLegacyResetAt(text) }
						: {}),
			},
		};
	}

	if (message.type === "result") {
		const resultUsage = usageFromSdkResult(message);
		const resultText = asString(message.result);
		const next: SdkSignals = {
			...signals,
			...(resultUsage ? { resultUsage } : {}),
			...(resultText !== undefined ? { resultText } : {}),
		};
		// Max turns is a normal stop for the run policy, not a harness failure.
		const failed =
			message.subtype === "error_max_turns"
				? false
				: message.is_error === true ||
					(typeof message.subtype === "string" &&
						message.subtype !== "success");
		if (!failed) return next;
		const errors = Array.isArray(message.errors)
			? message.errors.filter((e): e is string => typeof e === "string")
			: [];
		const text =
			asString(message.result)?.trim() ||
			errors.join("; ") ||
			`Claude Code run failed: ${String(message.subtype)}`;
		return { ...next, resultError: text };
	}

	return signals;
}

function usageFromChunk(chunk: AgUiChunk): AgentUsage | undefined {
	const metadata = isRecord(chunk.metadata) ? chunk.metadata : undefined;
	const tanstack =
		metadata && isRecord(metadata.tanstack) ? metadata.tanstack : undefined;
	const usage = isRecord(chunk.usage)
		? chunk.usage
		: tanstack && isRecord(tanstack.usage)
			? tanstack.usage
			: undefined;
	if (!usage) return undefined;
	const details = isRecord(usage.providerUsageDetails)
		? usage.providerUsageDetails
		: undefined;
	const costUsd = details ? asNumber(details.totalCostUsd) : undefined;
	return {
		inputTokens: asNumber(usage.promptTokens) ?? 0,
		outputTokens: asNumber(usage.completionTokens) ?? 0,
		...(costUsd !== undefined ? { costUsd } : {}),
	};
}

function toolInput(chunk: AgUiChunk): unknown {
	if ("input" in chunk && chunk.input !== undefined) return chunk.input;
	const metadata = isRecord(chunk.metadata) ? chunk.metadata : undefined;
	const tanstack =
		metadata && isRecord(metadata.tanstack) ? metadata.tanstack : undefined;
	return tanstack?.input ?? {};
}

function toolName(chunk: AgUiChunk): string | undefined {
	const metadata = isRecord(chunk.metadata) ? chunk.metadata : undefined;
	const tanstack =
		metadata && isRecord(metadata.tanstack) ? metadata.tanstack : undefined;
	return (
		asString(chunk.toolCallName) ??
		asString(chunk.toolName) ??
		asString(tanstack?.toolCallName) ??
		asString(tanstack?.toolName)
	);
}

function isErrorResult(chunk: AgUiChunk): boolean {
	if (chunk.state === "output-error") return true;
	const metadata = isRecord(chunk.metadata) ? chunk.metadata : undefined;
	const tanstack =
		metadata && isRecord(metadata.tanstack) ? metadata.tanstack : undefined;
	return tanstack?.state === "output-error";
}

/** The result the adapter synthesizes for a call the run never resolved. */
const INTERRUPTED_RESULT = JSON.stringify({ status: "interrupted" });

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return "Claude Code session failed";
}

function errorEvent(
	kind: AgentErrorKind,
	message: string,
	resetAt?: number,
): AgentEvent {
	return {
		type: "error",
		kind,
		message,
		...(resetAt !== undefined ? { resetAt } : {}),
	};
}

export type Translator = {
	/** Translate one AG-UI chunk. Returns the events to emit now. */
	push(chunk: unknown): AgentEvent[];
	/** Record one raw Claude Code stream-json message. */
	observeSdk(message: unknown): void;
	/** End the stream. Returns the remaining events, the terminal one last. */
	finish(input: FinishInput): AgentEvent[];
};

export function createTranslator(options: {
	/** Session id to report when the harness ends before it reports one. */
	fallbackSessionId: string;
	/** Turn `report_step` tool calls into `report` events. */
	stepReport?: boolean;
}): Translator {
	let sessionEmitted = false;
	let finished = false;
	/** Events that arrived before the session id; flushed after it. */
	const pending: AgentEvent[] = [];
	let signals: SdkSignals = {};
	let runFinished: { usage?: AgentUsage } | undefined;
	let runError: string | undefined;
	/** Tool names by call id: `chat()` can drop the name from TOOL_CALL_END. */
	const toolNames = new Map<string, string>();
	/** Report tool calls by call id, with their input once it is complete. */
	const reportCalls = new Map<
		string,
		{ name: string; input?: unknown; report?: StepReport }
	>();
	const isReportCall = (toolCallId: string, name: string | undefined) =>
		options.stepReport === true &&
		(reportCalls.has(toolCallId) || isReportTool(name));

	function emit(events: AgentEvent[]): AgentEvent[] {
		if (sessionEmitted) return events;
		pending.push(...events);
		return [];
	}

	function translate(chunk: AgUiChunk): AgentEvent[] {
		switch (chunk.type) {
			case "CUSTOM": {
				if (chunk.name !== SESSION_ID_EVENT || sessionEmitted) return [];
				const value = isRecord(chunk.value) ? chunk.value : {};
				const sessionId = asString(value.sessionId);
				if (!sessionId) return [];
				sessionEmitted = true;
				const model = asString(value.model);
				return [
					{ type: "session", sessionId, ...(model ? { model } : {}) },
					...pending.splice(0),
				];
			}
			case "TEXT_MESSAGE_CONTENT": {
				const delta = asString(chunk.delta);
				const messageId = asString(chunk.messageId);
				if (!delta || !messageId) return [];
				return emit([{ type: "text", messageId, delta }]);
			}
			case "TOOL_CALL_START": {
				const toolCallId = asString(chunk.toolCallId);
				if (!toolCallId) return [];
				const name = toolName(chunk) ?? "unknown";
				if (isReportCall(toolCallId, name)) {
					reportCalls.set(toolCallId, { name });
					return [];
				}
				toolNames.set(toolCallId, name);
				return emit([{ type: "tool-start", toolCallId, name }]);
			}
			case "TOOL_CALL_END": {
				const toolCallId = asString(chunk.toolCallId);
				if (!toolCallId) return [];
				if (isReportCall(toolCallId, toolName(chunk))) {
					const input = toolInput(chunk);
					reportCalls.set(toolCallId, {
						name:
							reportCalls.get(toolCallId)?.name ?? toolName(chunk) ?? "unknown",
						input,
						report: parseStepReport(input),
					});
					return [];
				}
				return emit([
					{
						type: "tool-end",
						toolCallId,
						name: toolName(chunk) ?? toolNames.get(toolCallId) ?? "unknown",
						input: toolInput(chunk),
					},
				]);
			}
			case "TOOL_CALL_RESULT": {
				const toolCallId = asString(chunk.toolCallId);
				if (!toolCallId) return [];
				const content = chunk.content;
				const call = reportCalls.get(toolCallId);
				if (call) {
					reportCalls.delete(toolCallId);
					if (call.report && !isErrorResult(chunk)) {
						if (content === INTERRUPTED_RESULT) return [];
						return emit([{ type: "report", ...call.report }]);
					}
					// A report that did not count stays visible, so a person can see why the step passed without one.
					return emit([
						{ type: "tool-start", toolCallId, name: call.name },
						{
							type: "tool-end",
							toolCallId,
							name: call.name,
							input: call.input,
						},
						{
							type: "tool-result",
							toolCallId,
							content:
								typeof content === "string" ? content : JSON.stringify(content),
						},
					]);
				}
				return emit([
					{
						type: "tool-result",
						toolCallId,
						content:
							typeof content === "string"
								? content
								: JSON.stringify(content ?? ""),
					},
				]);
			}
			case "RUN_FINISHED": {
				const usage = usageFromChunk(chunk);
				runFinished = usage ? { usage } : {};
				return [];
			}
			case "RUN_ERROR": {
				const error = isRecord(chunk.error) ? chunk.error : undefined;
				runError ??=
					asString(chunk.message) ??
					asString(error?.message) ??
					"Claude Code run failed";
				return [];
			}
			default:
				return [];
		}
	}

	function terminal({ aborted, thrown }: FinishInput): AgentEvent {
		if (aborted) return errorEvent("aborted", "The session was aborted");

		const failure =
			signals.resultError ??
			runError ??
			(thrown !== undefined ? errorMessage(thrown) : undefined);

		if (signals.usageLimit) {
			const { message, resetAt } = signals.usageLimit;
			return errorEvent(
				"usage-limit",
				message,
				resetAt ?? signals.rejectedResetAt,
			);
		}
		if (failure !== undefined) {
			if (signals.rejectedResetAt !== undefined || isUsageLimitText(failure)) {
				return errorEvent(
					"usage-limit",
					failure,
					parseLegacyResetAt(failure) ?? signals.rejectedResetAt,
				);
			}
			return errorEvent("harness", failure);
		}
		if (runFinished) {
			const usage = runFinished.usage ?? signals.resultUsage;
			return { type: "finished", ...(usage ? { usage } : {}) };
		}
		return errorEvent("harness", "Claude Code ended without a result");
	}

	return {
		push(chunk) {
			if (finished || !isRecord(chunk) || typeof chunk.type !== "string") {
				return [];
			}
			return translate(chunk as AgUiChunk);
		},
		observeSdk(message) {
			signals = observeSdkMessage(signals, message);
		},
		finish(input) {
			if (finished) return [];
			finished = true;
			const head: AgentEvent[] = sessionEmitted
				? []
				: [
						{ type: "session", sessionId: options.fallbackSessionId },
						...pending.splice(0),
					];
			sessionEmitted = true;
			const textReport =
				options.stepReport && !input.aborted && signals.resultText
					? parseTextReport(signals.resultText)
					: undefined;
			return [
				...head,
				...(textReport ? [{ type: "report" as const, ...textReport }] : []),
				terminal(input),
			];
		},
	};
}
