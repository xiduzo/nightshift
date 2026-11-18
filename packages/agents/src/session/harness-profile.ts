/**
 * How the translator reads one harness (`HarnessProfile`), and what the
 * raw messages of a harness say about its session (`SdkSignals`). Each
 * harness gives its own profile (Claude Code's is `CLAUDE_CODE_PROFILE`).
 */

import type { AgentEvent, AgentUsage, SessionLimit } from "../port";

type UsageLimit = { message: string; resetAt?: number };

/** What the raw harness messages say about how the session ended. */
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
	/**
	 * The harness stopped the session at a limit the session set: its turn
	 * limit, or its budget (Claude Code's `error_max_turns` and
	 * `error_max_budget_usd`). The session finishes with that limit.
	 */
	limit?: SessionLimit;
	/** What the session has used so far, while it runs: a running total. */
	liveUsage?: AgentUsage;
	/** The `result` text of the result message: the final assistant text. */
	resultText?: string;
	/**
	 * The harness's turn is over (OpenCode: the prompt call returned). The
	 * translator settles: the session can end without waiting for the
	 * adapter's RUN_FINISHED.
	 */
	done?: boolean;
	/**
	 * Tool inputs by call id, read from the raw messages (the last one wins).
	 * They win over the input of the adapter's TOOL_CALL_END.
	 */
	toolInputs?: Readonly<Record<string, unknown>>;
	/** Text message ids that are not assistant text (OpenCode echoes the prompt). */
	hiddenTextIds?: ReadonlySet<string>;
};

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
	/**
	 * The report tool's name in the harness's allow rules and tool calls,
	 * when it is not `report_step` (Claude Code: `mcp__tanstack__report_step`).
	 */
	reportToolId?: string;
	/** The same for the artifact tool (`mcp__tanstack__save_artifact`). */
	artifactToolId?: string;
	/**
	 * A fresh reader of the raw messages for the events the chunks do not
	 * carry, one per session: a subagent's message (each event with
	 * `parentToolCallId`), an update of a to-do list. It returns no events
	 * for any other message.
	 */
	createEventReader?: () => (message: unknown) => AgentEvent[];
	/**
	 * The name of the adapter's CUSTOM event that carries the agent's plan
	 * (ACP's `plan` update, `{entries}`). Each plan replaces the whole list:
	 * it shows as one `todo_list` call per session.
	 */
	planEvent?: string;
	/**
	 * The name of any other bridged tool in the harness's allow rules, when
	 * the harness asks before it runs one (Claude Code: `mcp__tanstack__<name>`).
	 */
	bridgedToolId?: (name: string) => string;
	/**
	 * The tool calls a harness ran inside another tool, read from that tool's
	 * result. OpenCode 2.x runs MCP tools inside its `execute` tool, so the
	 * stream never names `report_step`: a completed nested report counts as
	 * the step report. `name` is the bridged tool's own name (`report_step`).
	 */
	nestedToolCalls?: (
		content: unknown,
	) => { name: string; input: unknown; failed: boolean }[];
};
