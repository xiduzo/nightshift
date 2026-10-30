/**
 * How the translator (`session/translate.ts`) reads Claude Code. The AG-UI
 * translation drops what usage-limit detection needs: `rate_limit_event`,
 * the assistant `error` field and the result's `is_error`. This profile
 * reads them from the raw stream-json messages, and adds up the usage so
 * far over the model calls. It also names the report and artifact tools as
 * Claude Code sees them, for `--allowedTools`, and reads a subagent's
 * messages, which the AG-UI translation drops too.
 */
import type { BRIDGED_MCP_SERVER_NAME as ADAPTER_BRIDGE_NAME } from "@tanstack/ai-claude-code";
import type { AgentEvent, AgentUsage } from "../../port";
import {
	ARTIFACT_TOOL_NAME,
	asNumber,
	asString,
	failureKind,
	type HarnessProfile,
	isRecord,
	parseLegacyResetAt,
	REPORT_TOOL_NAME,
	type SdkSignals,
	toEpochMs,
} from "../../session";

export const SESSION_ID_EVENT = "claude-code.session-id";

/**
 * The name the adapter gives its MCP bridge. A copy, so the profile does not
 * load the adapter: the type fails when the package's name changes.
 */
const BRIDGED_MCP_SERVER_NAME: typeof ADAPTER_BRIDGE_NAME = "tanstack";

/** The report tool as Claude Code sees it: bridged over MCP, for `--allowedTools`. */
export const REPORT_TOOL_ID = `mcp__${BRIDGED_MCP_SERVER_NAME}__${REPORT_TOOL_NAME}`;

/** The artifact tool as Claude Code sees it. */
export const ARTIFACT_TOOL_ID = `mcp__${BRIDGED_MCP_SERVER_NAME}__${ARTIFACT_TOOL_NAME}`;

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

/** The tokens of a Claude API `usage` object: a model call's, or the session's. */
function tokensOf(usage: Record<string, unknown>): AgentUsage {
	const cacheReadTokens = asNumber(usage.cache_read_input_tokens) ?? 0;
	const cacheWriteTokens = asNumber(usage.cache_creation_input_tokens) ?? 0;
	const cacheWrite1hTokens = isRecord(usage.cache_creation)
		? asNumber(usage.cache_creation.ephemeral_1h_input_tokens)
		: undefined;
	return {
		inputTokens:
			(asNumber(usage.input_tokens) ?? 0) + cacheReadTokens + cacheWriteTokens,
		outputTokens: asNumber(usage.output_tokens) ?? 0,
		cacheReadTokens,
		cacheWriteTokens,
		...(cacheWrite1hTokens !== undefined ? { cacheWrite1hTokens } : {}),
	};
}

function usageFromSdkResult(
	message: Record<string, unknown>,
): AgentUsage | undefined {
	if (!isRecord(message.usage)) return undefined;
	const costUsd = asNumber(message.total_cost_usd);
	return {
		...tokensOf(message.usage),
		...(costUsd !== undefined ? { costUsd } : {}),
	};
}

/** The tokens of model calls added up. */
function sumTokens(usages: Iterable<AgentUsage>): AgentUsage {
	const total = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		cacheWrite1hTokens: 0,
	};
	for (const usage of usages) {
		total.inputTokens += usage.inputTokens;
		total.outputTokens += usage.outputTokens;
		total.cacheReadTokens += usage.cacheReadTokens ?? 0;
		total.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
		total.cacheWrite1hTokens += usage.cacheWrite1hTokens ?? 0;
	}
	return total;
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
		// The turn limit and the budget the session set are normal stops for
		// the run policy, not harness failures.
		const limit =
			message.subtype === "error_max_turns"
				? "turns"
				: message.subtype === "error_max_budget_usd"
					? "budget"
					: undefined;
		if (limit) return { ...next, limit };
		const failed =
			message.is_error === true ||
			(typeof message.subtype === "string" && message.subtype !== "success");
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

/**
 * The model call a Claude Code message tells the usage of: an assistant
 * message (one per content block, all with the id of their call), the
 * call's `message_start`, or its `message_delta`, which has no id but the
 * final output count.
 */
function claudeCallUsage(
	message: unknown,
	current: Map<string, string>,
): { id: string; usage: AgentUsage } | undefined {
	if (!isRecord(message)) return undefined;
	// The main agent and each subagent stream their calls apart.
	const stream = asString(message.parent_tool_use_id) ?? "";
	const call = (id: unknown, usage: unknown) => {
		const callId = asString(id);
		return callId && isRecord(usage)
			? { id: callId, usage: tokensOf(usage) }
			: undefined;
	};
	if (message.type === "assistant" && isRecord(message.message)) {
		return call(message.message.id, message.message.usage);
	}
	if (message.type !== "stream_event" || !isRecord(message.event)) {
		return undefined;
	}
	const event = message.event;
	if (event.type === "message_start" && isRecord(event.message)) {
		const id = asString(event.message.id);
		if (id) current.set(stream, id);
		return call(id, event.message.usage);
	}
	if (event.type === "message_delta") {
		return call(current.get(stream), event.usage);
	}
	return undefined;
}

/**
 * Claude Code's observer: `observeSdkMessage`, plus the usage so far, added
 * up over its model calls (`claudeCallUsage`). A call's output grows until
 * its `message_delta`; the cache split comes only with its start. Subagents'
 * calls count too: they cost the same.
 */
export function createClaudeCodeObserver(): (
	signals: SdkSignals,
	message: unknown,
) => SdkSignals {
	const calls = new Map<string, AgentUsage>();
	const current = new Map<string, string>();
	return (signals, message) => {
		const next = observeSdkMessage(signals, message);
		const call = claudeCallUsage(message, current);
		if (!call) return next;
		const before = calls.get(call.id);
		calls.set(call.id, {
			...before,
			...call.usage,
			outputTokens: Math.max(
				before?.outputTokens ?? 0,
				call.usage.outputTokens,
			),
		});
		return { ...next, liveUsage: sumTokens(calls.values()) };
	};
}

/** The text of a tool result: a string, or the text of its blocks. */
function resultText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return JSON.stringify(content ?? "");
	return content
		.map((block) =>
			isRecord(block) && block.type === "text"
				? (asString(block.text) ?? "")
				: "",
		)
		.join("\n");
}

/** A bridged tool's name without the bridge prefix, as the adapter names it. */
function toolNameOf(name: string): string {
	const prefix = `mcp__${BRIDGED_MCP_SERVER_NAME}__`;
	return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/**
 * Claude Code's subagent reader. A subagent (started by the Task or Agent
 * tool) writes whole `assistant` and `user` messages with
 * `parent_tool_use_id` set; the adapter drops them. This turns their text,
 * thinking, tool calls and tool results into events. Its partial
 * `stream_event` messages repeat the whole ones and are skipped. Redacted
 * thinking (`redacted_thinking`) and empty thinking are skipped.
 */
export function createClaudeCodeSubagentReader(): (
	message: unknown,
) => AgentEvent[] {
	/** Text and thinking blocks so far: one message id per block. */
	let blocks = 0;
	return (message) => {
		if (!isRecord(message)) return [];
		const parentToolCallId = asString(message.parent_tool_use_id);
		if (!parentToolCallId) return [];
		const inner = message.message;
		if (!isRecord(inner) || !Array.isArray(inner.content)) return [];
		const events: AgentEvent[] = [];
		if (message.type === "assistant") {
			const id = asString(inner.id) ?? parentToolCallId;
			for (const block of inner.content) {
				if (!isRecord(block)) continue;
				const text =
					block.type === "text"
						? asString(block.text)
						: block.type === "thinking"
							? asString(block.thinking)
							: undefined;
				if (text) {
					blocks += 1;
					events.push({
						type: block.type === "text" ? "text" : "thinking",
						messageId: `${id}:${blocks}`,
						delta: text,
						parentToolCallId,
					});
					continue;
				}
				const toolCallId = asString(block.id);
				const name = asString(block.name);
				if (block.type !== "tool_use" || !toolCallId || !name) continue;
				const tool = toolNameOf(name);
				events.push(
					{ type: "tool-start", toolCallId, name: tool, parentToolCallId },
					{
						type: "tool-end",
						toolCallId,
						name: tool,
						input: block.input ?? {},
						parentToolCallId,
					},
				);
			}
		} else if (message.type === "user") {
			for (const block of inner.content) {
				if (!isRecord(block) || block.type !== "tool_result") continue;
				const toolCallId = asString(block.tool_use_id);
				if (!toolCallId) continue;
				events.push({
					type: "tool-result",
					toolCallId,
					content: resultText(block.content),
					...(block.is_error === true ? { isError: true as const } : {}),
					parentToolCallId,
				});
			}
		}
		return events;
	};
}

export const CLAUDE_CODE_PROFILE: HarnessProfile = {
	label: "Claude Code",
	sessionEvent: SESSION_ID_EVENT,
	createObserver: createClaudeCodeObserver,
	createSubagentReader: createClaudeCodeSubagentReader,
	reportToolId: REPORT_TOOL_ID,
	artifactToolId: ARTIFACT_TOOL_ID,
	bridgedToolId: (name) => `mcp__${BRIDGED_MCP_SERVER_NAME}__${name}`,
};
