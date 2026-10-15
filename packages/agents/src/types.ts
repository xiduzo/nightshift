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
	/**
	 * Ask the agent for a step report: the harness tells the agent how to
	 * report and emits one `report` event when it does. A session that
	 * finishes without a report is treated as `pass` by the engine.
	 */
	stepReport?: boolean;
	/** Tool sets the session gets on top of the harness's own tools. */
	tools?: ToolSet[];
	/** Aborting stops the harness process. The stream then ends with an `error` event of kind `aborted`. */
	signal: AbortSignal;
};

export type AgentUsage = {
	inputTokens: number;
	outputTokens: number;
	costUsd?: number;
};

/** `github`: the GitHub tools on top of `gh`, scoped to the repo of `cwd`. */
export type ToolSet = "github";

export type StepReportOutcome = "pass" | "fail" | "needs-input";

/**
 * `usage-limit`: the harness hit a usage or rate limit (`resetAt` when known).
 * `network`: the harness could not reach its service (DNS, refused, 5xx, …).
 * The engine waits and continues the same session for both.
 */
export type AgentErrorKind = "aborted" | "usage-limit" | "network" | "harness";

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
	/** The agent's step report. When the agent reports twice, the last one counts. */
	| { type: "report"; outcome: StepReportOutcome; summary: string }
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

export type DecisionInput = {
	/** Where tools run, for example `gh` against the worktree's repo. */
	cwd: string;
	/** The rendered question with its context. */
	prompt: string;
	labels: { name: string; description?: string }[];
	model: string;
	tools?: ToolSet[];
	signal: AbortSignal;
};

/** A decision, or why there is none. */
export type DecisionResult =
	| { kind: "decided"; label: string; notes: string; costUsd: number | null }
	| {
			kind: "error";
			/** `aborted` when the signal fired. */
			errorKind: AgentErrorKind;
			message: string;
			costUsd: number | null;
	  };

/**
 * Picks one label for a Decision node. The default provider is a short
 * Claude Code session whose only way to answer is a `decide` tool whose
 * input is checked against the labels. Other providers plug in behind this.
 */
export interface Decider {
	readonly name: string;
	/** Never throws: failures come back as `kind: "error"`. */
	decide(input: DecisionInput): Promise<DecisionResult>;
}

/** Input for reading For Each items from GitHub sub-issues. */
export type GithubItemsInput = {
	/** A directory in the repo; `gh` resolves the repo from its remote. */
	cwd: string;
	parent: number;
	requireLabel?: string;
	doneLabels: string[];
	/** Sub-issues with one of these labels are left out of the list. */
	skipLabels?: string[];
	signal: AbortSignal;
};
