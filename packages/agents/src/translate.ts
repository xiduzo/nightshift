/**
 * Pure translation from the TanStack AI stream of a harness session (Claude
 * Code, OpenCode, Codex) to normalized AgentEvent values.
 *
 * Two inputs feed one translator:
 * - AG-UI chunks yielded by `chat()` (`push`).
 * - Raw harness messages (`observeSdk`), tapped from the adapter's provider
 *   log. The AG-UI translation drops what usage-limit detection needs (for
 *   Claude Code: `rate_limit_event`, the assistant `error` field, the
 *   result's `is_error`), so those are read from the raw messages. A
 *   `HarnessProfile` says how to read them; the default is Claude Code's.
 *
 * The translator enforces the stream contract: one `session` event first and
 * one terminal `finished` / `error` event last (from `finish`).
 *
 * A `tool-result` carries `isError: true` when the harness marks the result
 * as an error. Every adapter maps its own flag (Claude Code's `is_error`,
 * Codex and Grok Build's failed item, OpenCode's error state, ACP's failed
 * status) to the chunk's `output-error` state.
 *
 * Step reports (`stepReport` on: `true` or a spec), see `step-report.ts`:
 * - A `report_step` call with a valid input (`parseStepReport`) becomes one
 *   `report` event, emitted when its result arrives. After a successful
 *   result the call itself is harness plumbing: its `tool-start` /
 *   `tool-end` / `tool-result` events are not emitted.
 * - A valid report whose result is an error still counts, unless the
 *   result says the report was refused (`isRefusedReport`: Night Shift's
 *   own check, the harness's input check, or a permission denial). The
 *   agent sent the report; only its delivery failed (the bridge was gone,
 *   for example). The tool events are emitted, with `isError` on the
 *   result, and the `report` event follows them: the transcript shows the
 *   failed delivery and the report that counted.
 * - A call with an invalid input, or a refused one, emits its tool events
 *   and no report, so the transcript shows the report that did not count.
 * - A `NIGHTSHIFT-REPORT: {...}` line in the final result text becomes one
 *   `report` event just before the terminal event. The line stays in the
 *   streamed text.
 * Both channels are read in every mode; the last report counts.
 */
import {
	isRefusedReport,
	isReportTool,
	parseStepReport,
	parseTextReport,
	reportRules,
	type StepReport,
} from "./step-report";
import type {
	AgentErrorKind,
	AgentEvent,
	AgentUsage,
	StepReportSpec,
} from "./types";

/** The AG-UI chunk shape this module reads. Every field is checked at runtime. */
export type AgUiChunk = { type: string; [key: string]: unknown };

export const SESSION_ID_EVENT = "claude-code.session-id";

type UsageLimit = { message: string; resetAt?: number };

/** What the raw Claude Code messages say about how the session ended. */
export type SdkSignals = {
	/** An assistant message reported a rate or usage limit. */
	usageLimit?: UsageLimit;
	/** An assistant message reported an API error that means the network or the service is down. */
	networkError?: string;
	/** Reset time of the last `rate_limit_event` with status `rejected`. */
	rejectedResetAt?: number;
	/** The result message reported a failure. */
	resultError?: string;
	/** Usage from the result message, a fallback for RUN_FINISHED usage. */
	resultUsage?: AgentUsage;
	/** The `result` text of the result message: the final assistant text. */
	resultText?: string;
	/**
	 * The harness's turn is over (OpenCode: the prompt call returned). The
	 * translator settles: the session can end without waiting for the
	 * adapter's RUN_FINISHED.
	 */
	done?: boolean;
	/** Tool inputs by call id, read from the raw messages (the last one wins). */
	toolInputs?: Readonly<Record<string, unknown>>;
	/** Text message ids that are not assistant text (OpenCode echoes the prompt). */
	hiddenTextIds?: ReadonlySet<string>;
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

/**
 * A usage or primary rate limit: the account is out of usage for now. Ported
 * from `LIMITED` in `night-shift.py`, plus Claude Code's own wording.
 */
const USAGE_LIMIT_TEXT =
	/usage limit|session limit|weekly limit|hit your (?:\w+ )?limit|limit reached|out of (?:extra )?usage|rate.?limit|\b429\b|too many requests|quota/i;

/**
 * The service cannot be reached: DNS, refused or reset connections, timeouts,
 * TLS, HTTP 5xx, and GitHub's secondary rate limit (a short back-off, not an
 * exhausted account). Ported from `OFFLINE` in `night-shift.py` (without its
 * own "did not finish in" timeout text), plus the wording of Claude Code's API
 * errors (`API Error: 529 …`, `Connection error.`, `Request timed out.`),
 * Bun's fetch errors as OpenCode reports them (`Unable to connect`), Codex's
 * (`stream disconnected …`, `error sending request …`), and Node's socket
 * error codes.
 */
const NETWORK_TEXT = new RegExp(
	[
		"error connecting to",
		"could not resolve host",
		"no such host",
		"name resolution",
		"network is (?:unreachable|down)",
		"connection (?:refused|reset|timed out|closed|error)",
		"operation timed out",
		"request timed out",
		"i/o timeout",
		"tls handshake",
		"unexpected eof",
		"remote end hung up",
		"socket hang up",
		"fetch failed",
		"unable to connect",
		"socket connection was closed",
		"stream disconnected",
		"error sending request",
		"\\bHTTP 5\\d\\d\\b",
		"\\bapi error\\W{0,3}5\\d\\d\\b",
		"bad gateway",
		"service unavailable",
		"gateway time-?out",
		"overloaded",
		"secondary rate.?limit",
		"\\b(?:ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ENETUNREACH|ENETDOWN|EHOSTUNREACH|EPIPE|ConnectionRefused)\\b",
	].join("|"),
	"i",
);

/** GitHub's secondary rate limit says "rate limit" but is a network wait. */
const SECONDARY_RATE_LIMIT = /secondary rate.?limit/i;

/** Older Claude Code versions end the message with `|<epoch seconds>`. */
const LEGACY_RESET = /\|(\d{10,13})\s*$/;

/**
 * What a failure text says about why the harness stopped: `usage-limit`,
 * `network`, or undefined for any other failure. A secondary rate limit is
 * `network`; a usage limit, a primary rate limit, a 429, or a quota is
 * `usage-limit`, also when the text mentions the network too.
 */
export function failureKind(
	text: string,
): "usage-limit" | "network" | undefined {
	if (SECONDARY_RATE_LIMIT.test(text)) return "network";
	if (USAGE_LIMIT_TEXT.test(text)) return "usage-limit";
	if (NETWORK_TEXT.test(text)) return "network";
	return undefined;
}

export function isUsageLimitText(text: string): boolean {
	return failureKind(text) === "usage-limit";
}

export function isNetworkText(text: string): boolean {
	return failureKind(text) === "network";
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
	const cacheReadTokens = asNumber(usage.cache_read_input_tokens) ?? 0;
	const cacheWriteTokens = asNumber(usage.cache_creation_input_tokens) ?? 0;
	const inputTokens =
		(asNumber(usage.input_tokens) ?? 0) + cacheReadTokens + cacheWriteTokens;
	const costUsd = asNumber(message.total_cost_usd);
	return {
		inputTokens,
		outputTokens: asNumber(usage.output_tokens) ?? 0,
		cacheReadTokens,
		cacheWriteTokens,
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
		if (!isLimit) {
			const error = asString(message.error);
			if (!error) return signals;
			const text = assistantText(message);
			const isNetwork =
				error === "server_error" ||
				failureKind(text) === "network" ||
				failureKind(error) === "network";
			return isNetwork
				? {
						...signals,
						networkError: text || "Claude Code could not reach its API",
					}
				: signals;
		}
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
	const prompt = isRecord(usage.promptTokensDetails)
		? usage.promptTokensDetails
		: undefined;
	const cacheReadTokens = prompt ? asNumber(prompt.cachedTokens) : undefined;
	const cacheWriteTokens = prompt
		? asNumber(prompt.cacheWriteTokens)
		: undefined;
	return {
		inputTokens: asNumber(usage.promptTokens) ?? 0,
		outputTokens: asNumber(usage.completionTokens) ?? 0,
		...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
		...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
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

function errorMessage(error: unknown, label: string): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === "string" && error) return error;
	return `${label} session failed`;
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

/** How a translator reads one harness: its name, session event, and raw messages. */
export type HarnessProfile = {
	/** The harness name in error texts, for example "Claude Code". */
	label: string;
	/** The name of the adapter's CUSTOM event that carries the session id. */
	sessionEvent: string;
	/**
	 * A fresh fold of the raw messages into signals, one per session (it may
	 * keep state). Claude Code's is `observeSdkMessage`.
	 */
	createObserver: () => (signals: SdkSignals, message: unknown) => SdkSignals;
	/**
	 * Report `resultUsage` instead of the RUN_FINISHED usage: the harness's
	 * own total over every step of the turn.
	 */
	usageFromSignals?: boolean;
	/**
	 * The adapter's TOOL_CALL_END carries no input yet (OpenCode opens a call
	 * on its first, empty update). Emit `tool-end` with the result instead,
	 * with the input from `toolInputs`.
	 */
	toolInputFromSignals?: boolean;
};

export const CLAUDE_CODE_PROFILE: HarnessProfile = {
	label: "Claude Code",
	sessionEvent: SESSION_ID_EVENT,
	createObserver: () => observeSdkMessage,
};

export type Translator = {
	/** Translate one AG-UI chunk. Returns the events to emit now. */
	push(chunk: unknown): AgentEvent[];
	/** Record one raw harness message (Claude Code: a stream-json message). */
	observeSdk(message: unknown): void;
	/** End the stream. Returns the remaining events, the terminal one last. */
	finish(input: FinishInput): AgentEvent[];
	/** The raw messages say the turn is over (`done`): no need to wait for more chunks. */
	settled(): boolean;
};

export function createTranslator(options: {
	/** Session id to report when the harness ends before it reports one. */
	fallbackSessionId: string;
	/**
	 * Turn `report_step` tool calls into `report` events, checked against the
	 * spec's outcomes and output (see `parseStepReport`).
	 */
	stepReport?: boolean | StepReportSpec;
	/** The harness. Default: Claude Code. */
	profile?: HarnessProfile;
	/**
	 * A session id known before the harness reports one (a resumed session).
	 * The `session` event goes out with the first chunk instead of waiting.
	 */
	knownSessionId?: string;
}): Translator {
	const rules = reportRules(options.stepReport);
	const profile = options.profile ?? CLAUDE_CODE_PROFILE;
	const observe = profile.createObserver();
	let sessionEmitted = false;
	let finished = false;
	/** Events that arrived before the session id; flushed after it. */
	const pending: AgentEvent[] = [];
	let signals: SdkSignals = {};
	let runFinished: { usage?: AgentUsage } | undefined;
	let runError: string | undefined;
	/** Tool names by call id: `chat()` can drop the name from TOOL_CALL_END. */
	const toolNames = new Map<string, string>();
	/** `tool-end` events held for their input (`toolInputFromSignals`). */
	const heldEnds = new Map<string, Extract<AgentEvent, { type: "tool-end" }>>();
	const rawInput = (toolCallId: string, fallback: unknown): unknown =>
		signals.toolInputs?.[toolCallId] ?? fallback;
	/** Report tool calls by call id, with their input once it is complete. */
	const reportCalls = new Map<
		string,
		{ name: string; input?: unknown; report?: StepReport }
	>();
	const isReportCall = (toolCallId: string, name: string | undefined) =>
		rules !== undefined && (reportCalls.has(toolCallId) || isReportTool(name));

	function emit(events: AgentEvent[]): AgentEvent[] {
		if (sessionEmitted) return events;
		pending.push(...events);
		return [];
	}

	function translate(chunk: AgUiChunk): AgentEvent[] {
		switch (chunk.type) {
			case "CUSTOM": {
				if (chunk.name !== profile.sessionEvent || sessionEmitted) return [];
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
				if (signals.hiddenTextIds?.has(messageId)) return [];
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
						report: parseStepReport(input, rules),
					});
					return [];
				}
				const end: Extract<AgentEvent, { type: "tool-end" }> = {
					type: "tool-end",
					toolCallId,
					name: toolName(chunk) ?? toolNames.get(toolCallId) ?? "unknown",
					input: toolInput(chunk),
				};
				if (profile.toolInputFromSignals) {
					heldEnds.set(toolCallId, end);
					return [];
				}
				return emit([end]);
			}
			case "TOOL_CALL_RESULT": {
				const toolCallId = asString(chunk.toolCallId);
				if (!toolCallId) return [];
				const content = chunk.content;
				const failed = isErrorResult(chunk);
				const call = reportCalls.get(toolCallId);
				if (call) {
					reportCalls.delete(toolCallId);
					if (profile.toolInputFromSignals) {
						call.input = rawInput(toolCallId, call.input);
						call.report = parseStepReport(call.input, rules);
					}
					if (call.report && !failed) {
						if (content === INTERRUPTED_RESULT) return [];
						return emit([{ type: "report", ...call.report }]);
					}
					const text =
						typeof content === "string"
							? content
							: JSON.stringify(content ?? "");
					// Here a valid report means its delivery failed: it counts unless it was refused.
					const counted =
						call.report && !isRefusedReport(text) ? call.report : undefined;
					// The call stays visible, so a person can see why the report failed or did not count.
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
							content: text,
							...(failed ? { isError: true as const } : {}),
						},
						...(counted ? [{ type: "report" as const, ...counted }] : []),
					]);
				}
				const held = heldEnds.get(toolCallId);
				heldEnds.delete(toolCallId);
				return emit([
					...(held
						? [{ ...held, input: rawInput(toolCallId, held.input) }]
						: []),
					{
						type: "tool-result",
						toolCallId,
						content:
							typeof content === "string"
								? content
								: JSON.stringify(content ?? ""),
						...(failed ? { isError: true as const } : {}),
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
					`${profile.label} run failed`;
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
			(thrown !== undefined ? errorMessage(thrown, profile.label) : undefined);

		if (signals.usageLimit) {
			const { message, resetAt } = signals.usageLimit;
			return errorEvent(
				"usage-limit",
				message,
				resetAt ?? signals.rejectedResetAt,
			);
		}
		if (failure !== undefined) {
			const kind = failureKind(failure);
			if (signals.rejectedResetAt !== undefined || kind === "usage-limit") {
				return errorEvent(
					"usage-limit",
					failure,
					parseLegacyResetAt(failure) ?? signals.rejectedResetAt,
				);
			}
			if (kind === "network" || signals.networkError !== undefined) {
				return errorEvent("network", failure);
			}
			return errorEvent("harness", failure);
		}
		if (runFinished || signals.done) {
			const usage = finishedUsage(runFinished?.usage, signals.resultUsage);
			return { type: "finished", ...(usage ? { usage } : {}) };
		}
		if (signals.networkError !== undefined) {
			return errorEvent("network", signals.networkError);
		}
		return errorEvent("harness", `${profile.label} ended without a result`);
	}

	/** The chunk's usage (or the harness's own total), with the cost from the raw messages when the chunk has none. */
	function finishedUsage(
		chunk: AgentUsage | undefined,
		raw: AgentUsage | undefined,
	): AgentUsage | undefined {
		const usage = profile.usageFromSignals ? (raw ?? chunk) : (chunk ?? raw);
		if (!usage || usage.costUsd !== undefined || raw?.costUsd === undefined) {
			return usage;
		}
		return { ...usage, costUsd: raw.costUsd };
	}

	function startKnownSession(): AgentEvent[] {
		if (sessionEmitted || options.knownSessionId === undefined) return [];
		sessionEmitted = true;
		return [{ type: "session", sessionId: options.knownSessionId }];
	}

	return {
		push(chunk) {
			if (finished || !isRecord(chunk) || typeof chunk.type !== "string") {
				return [];
			}
			return [...startKnownSession(), ...translate(chunk as AgUiChunk)];
		},
		observeSdk(message) {
			signals = observe(signals, message);
		},
		finish(input) {
			if (finished) return [];
			finished = true;
			const head: AgentEvent[] = sessionEmitted
				? []
				: [
						{
							type: "session",
							sessionId: options.knownSessionId ?? options.fallbackSessionId,
						},
						...pending.splice(0),
					];
			sessionEmitted = true;
			// Calls that never got a result: show them with the input they had.
			const ends = [...heldEnds.values()].map((end) => ({
				...end,
				input: rawInput(end.toolCallId, end.input),
			}));
			heldEnds.clear();
			const textReport =
				rules && !input.aborted && signals.resultText
					? parseTextReport(signals.resultText, rules)
					: undefined;
			return [
				...head,
				...ends,
				...(textReport ? [{ type: "report" as const, ...textReport }] : []),
				terminal(input),
			];
		},
		settled() {
			return signals.done === true;
		},
	};
}
