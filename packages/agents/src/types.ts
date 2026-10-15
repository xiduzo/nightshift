/**
 * The harness-agnostic contract between the engine and an agent harness.
 * The engine only sees these types. A harness adapter (Claude Code, and later
 * OpenCode and Codex) translates its own stream into AgentEvent values.
 */

export type HarnessName = "claude-code";

export type PermissionMode =
	| "default"
	| "acceptEdits"
	| "bypassPermissions"
	| "plan";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export type AgentSessionInput = {
	/** Absolute path of the working directory (the run's worktree). */
	cwd: string;
	/** The user message for this turn. On resume, the follow-up message. */
	prompt: string;
	/** Harness model name or alias, for example "sonnet" or "haiku". */
	model: string;
	permissionMode: PermissionMode;
	effort?: Effort;
	/** Continue this harness session instead of starting a new one. */
	resumeSessionId?: string;
	/** Aborting stops the harness process. The stream then ends with an `error` event of kind `aborted`. */
	signal: AbortSignal;
};

export type AgentUsage = {
	inputTokens: number;
	outputTokens: number;
	costUsd?: number;
};

export type AgentErrorKind = "aborted" | "usage-limit" | "harness";

/**
 * One normalized event of a harness session. Every stream emits exactly one
 * `session` event first (as soon as the harness reports its id) and ends with
 * exactly one `finished` or `error` event.
 */
export type AgentEvent =
	| { type: "session"; sessionId: string; model?: string }
	| { type: "text"; messageId: string; delta: string }
	| { type: "tool-start"; toolCallId: string; name: string }
	| { type: "tool-end"; toolCallId: string; name: string; input: unknown }
	| { type: "tool-result"; toolCallId: string; content: string }
	| { type: "finished"; usage?: AgentUsage }
	| {
			type: "error";
			kind: AgentErrorKind;
			message: string;
			/** Epoch ms when a usage limit resets, when the harness reports it. */
			resetAt?: number;
	  };

export interface AgentHarness {
	readonly name: HarnessName;
	/** Start or resume one session. Never throws: failures end the stream with an `error` event. */
	run(input: AgentSessionInput): AsyncIterable<AgentEvent>;
}
