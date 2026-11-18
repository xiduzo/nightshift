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
 *   `HarnessProfile` says how to read them. Each harness has its own
 *   (Claude Code's is `CLAUDE_CODE_PROFILE`).
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
 *
 * Thinking: every adapter turns the model's visible thinking into
 * REASONING_MESSAGE_CONTENT chunks (Claude Code's thinking blocks, Codex's
 * reasoning items, OpenCode's reasoning parts, ACP's `agent_thought_chunk`).
 * Each becomes a `thinking` event. Redacted thinking never reaches a chunk,
 * and REASONING_ENCRYPTED_VALUE chunks are dropped: no ciphertext goes out.
 *
 * Raw events: the adapters drop some of what the raw messages say from the
 * chunks: a subagent's messages, the updates of Codex's to-do list. A
 * profile that can read them (`createEventReader`) turns them into events
 * (a subagent's with `parentToolCallId`). They arrive while the chunk
 * stream is quiet, so the translator queues them: `push` and `finish` send
 * them first, and `drain` sends them in between (`whenQueued`).
 *
 * To-do lists the harness keeps itself (Codex's to-do list, an ACP agent's
 * plan) show as a `todo_list` call: the list as `{items}` in its input
 * while the agent works, each update a new `tool-end` that replaces it.
 *
 * The translator is one state machine over one stream. What it reads and
 * sorts is in the files beside it: the fields of a chunk (`ag-ui-chunk.ts`),
 * the failure texts (`failure.ts`), and how it reads one harness
 * (`harness-profile.ts`). What one harness reads in its raw messages is in
 * that harness's profile.
 */

import type {
	AgentErrorKind,
	AgentEvent,
	AgentUsage,
	StepReportSpec,
} from "../port";
import {
	type AgUiChunk,
	isErrorResult,
	toolInput,
	toolName,
	usageFromChunk,
} from "./ag-ui-chunk";
import {
	errorEvent,
	failureKind,
	PROCESS_EXIT,
	parseLegacyResetAt,
	thrownText,
	thrownWords,
} from "./failure";
import type { HarnessProfile, SdkSignals } from "./harness-profile";
import { asString, isRecord } from "./raw-value";
import { isReportTool, reportRules, type StepReport } from "./step-report";
import {
	isRefusedReport,
	parseStepReport,
	parseTextReport,
} from "./step-report-parse";

export type FinishInput = {
	/** The caller aborted the session. Wins over every other outcome. */
	aborted: boolean;
	/** The chunk stream threw instead of ending. */
	thrown?: unknown;
};

/** Same tokens and cost: a `usage` event would tell nothing new. */
function sameUsage(a: AgentUsage | undefined, b: AgentUsage): boolean {
	return (
		a !== undefined &&
		a.inputTokens === b.inputTokens &&
		a.outputTokens === b.outputTokens &&
		a.cacheReadTokens === b.cacheReadTokens &&
		a.cacheWriteTokens === b.cacheWriteTokens &&
		a.cacheWrite1hTokens === b.cacheWrite1hTokens &&
		a.costUsd === b.costUsd
	);
}

/** The tool name of a to-do list the harness keeps itself: Codex's, and an ACP agent's plan. */
export const TODO_LIST = "todo_list";

/** The call id of an agent's plan: one call per session. */
const PLAN_CALL_ID = "plan";

/** The result the adapter synthesizes for a call the run never resolved. */
const INTERRUPTED_RESULT = JSON.stringify({ status: "interrupted" });

export type Translator = {
	/** Translate one AG-UI chunk. Returns the events to emit now. */
	push(chunk: unknown): AgentEvent[];
	/** Record one raw harness message (Claude Code: a stream-json message). */
	observeSdk(message: unknown): void;
	/** The events the raw messages queued since the last call (subagent events). */
	drain(): AgentEvent[];
	/** Resolves once `drain` has events to return. */
	whenQueued(): Promise<void>;
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
	/** How to read the harness. */
	profile: HarnessProfile;
	/**
	 * A session id known before the harness reports one (a resumed session).
	 * The `session` event goes out with the first chunk instead of waiting.
	 */
	knownSessionId?: string;
}): Translator {
	const rules = reportRules(options.stepReport);
	const profile = options.profile;
	const observe = profile.createObserver();
	const readEvents = profile.createEventReader?.();
	/** Events from the raw messages, waiting for `push`, `drain` or `finish`. */
	const queued: AgentEvent[] = [];
	/** Resolves the pending `whenQueued` promises. */
	const waiting: (() => void)[] = [];
	let sessionEmitted = false;
	let finished = false;
	/** Events that arrived before the session id; flushed after it. */
	const pending: AgentEvent[] = [];
	let signals: SdkSignals = {};
	let runFinished: { usage?: AgentUsage } | undefined;
	let runError: string | undefined;
	/** The last `usage` event sent. */
	let liveSent: AgentUsage | undefined;
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
		rules !== undefined &&
		(reportCalls.has(toolCallId) || isReportTool(name, profile.reportToolId));
	/** The last plan sent, as JSON. */
	let lastPlan: string | undefined;

	/**
	 * The events of one plan: the first opens the session's plan call, each
	 * one replaces its list. A plan the same as the last sends nothing: the
	 * loop guard would count it as the same call again.
	 */
	function plan(value: unknown): AgentEvent[] {
		const entries =
			isRecord(value) && Array.isArray(value.entries) ? value.entries : [];
		const items = { items: entries };
		const content = JSON.stringify(items);
		if (content === lastPlan) return [];
		const start: AgentEvent[] =
			lastPlan === undefined
				? [{ type: "tool-start", toolCallId: PLAN_CALL_ID, name: TODO_LIST }]
				: [];
		lastPlan = content;
		return [
			...start,
			{
				type: "tool-end",
				toolCallId: PLAN_CALL_ID,
				name: TODO_LIST,
				input: items,
			},
			{ type: "tool-result", toolCallId: PLAN_CALL_ID, content },
		];
	}

	function emit(events: AgentEvent[]): AgentEvent[] {
		if (sessionEmitted) return events;
		pending.push(...events);
		return [];
	}

	function translate(chunk: AgUiChunk): AgentEvent[] {
		switch (chunk.type) {
			case "CUSTOM": {
				if (
					profile.planEvent !== undefined &&
					chunk.name === profile.planEvent
				) {
					return emit(plan(chunk.value));
				}
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
			case "REASONING_MESSAGE_CONTENT": {
				const delta = asString(chunk.delta);
				const messageId = asString(chunk.messageId);
				if (!delta || !messageId) return [];
				return emit([{ type: "thinking", messageId, delta }]);
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
					input: rawInput(toolCallId, toolInput(chunk)),
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
				const nested = rules
					? (profile.nestedToolCalls?.(content) ?? []).flatMap((call) => {
							if (call.failed || !isReportTool(call.name)) return [];
							const report = parseStepReport(call.input, rules);
							return report ? [{ type: "report" as const, ...report }] : [];
						})
					: [];
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
					...nested,
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

		// A limit the session set is a normal stop: the engine decides what it means.
		if (signals.limit) {
			const usage = finishedUsage(runFinished?.usage, signals.resultUsage);
			return {
				type: "finished",
				...(usage ? { usage } : {}),
				limit: signals.limit,
			};
		}

		// The harness's own report of a failure is its words. A throw is not:
		// its text only sorts the failure, and the person sees plain words.
		// Neither is a crash of the harness program, which the adapter reports.
		const crash =
			runError !== undefined && PROCESS_EXIT.test(runError)
				? new Error(runError)
				: undefined;
		const reported = signals.resultError ?? (crash ? undefined : runError);
		const raised = thrown ?? crash;
		const failure =
			reported ??
			(raised !== undefined ? thrownText(raised, profile.label) : undefined);
		const shown = (kind: AgentErrorKind) =>
			reported ?? thrownWords(raised, profile.label, kind);

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
					shown("usage-limit"),
					parseLegacyResetAt(failure) ?? signals.rejectedResetAt,
				);
			}
			if (kind === "network" || signals.networkError !== undefined) {
				return errorEvent("network", shown("network"));
			}
			return errorEvent("harness", shown("harness"));
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

	/** A `usage` event when the usage so far changed since the last one. */
	function liveUsage(): AgentEvent[] {
		const usage = signals.liveUsage;
		if (!sessionEmitted || !usage || sameUsage(liveSent, usage)) return [];
		liveSent = usage;
		return [{ type: "usage", usage }];
	}

	function startKnownSession(): AgentEvent[] {
		if (sessionEmitted || options.knownSessionId === undefined) return [];
		sessionEmitted = true;
		return [
			{ type: "session", sessionId: options.knownSessionId },
			...pending.splice(0),
		];
	}

	return {
		push(chunk) {
			if (finished || !isRecord(chunk) || typeof chunk.type !== "string") {
				return [];
			}
			return [
				...startKnownSession(),
				...queued.splice(0),
				...translate(chunk as AgUiChunk),
				...liveUsage(),
			];
		},
		observeSdk(message) {
			signals = observe(signals, message);
			if (finished || !readEvents) return;
			queued.push(...emit(readEvents(message)));
			if (queued.length > 0) for (const resolve of waiting.splice(0)) resolve();
		},
		drain() {
			return queued.splice(0);
		},
		whenQueued() {
			if (queued.length > 0) return Promise.resolve();
			return new Promise((resolve) => waiting.push(resolve));
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
				...queued.splice(0),
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
