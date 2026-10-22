/**
 * The harness-agnostic contract between the engine and an agent harness.
 * The engine only sees these types. A harness adapter translates its own
 * stream into AgentEvent values.
 */

import type {
	AgentHarnessName,
	CustomHarnessName,
	DeciderName,
	HarnessName,
} from "@nightshift/flows";

export type { AgentHarnessName, CustomHarnessName, DeciderName, HarnessName };

/** An MCP server for one session, with `${NAME}` already expanded by the engine. */
export type McpServerConfig =
	| { command: string; args: string[]; env: Record<string, string> }
	| { url: string; headers: Record<string, string> };

/**
 * `auto`: Claude Code's classifier approves safe actions (running tests,
 * reading, editing) without a person, and blocks risky ones. The mode for
 * unattended nights, as night-shift.py used.
 */
export type PermissionMode =
	| "default"
	| "acceptEdits"
	| "auto"
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
	 * finishes without a report is treated as `pass` by the engine (or as
	 * `error` when the spec has its own outcomes or an output schema).
	 * `true` asks for `pass`, `fail` or `needs-input`; a spec sets the
	 * outcomes and a JSON Schema for the report's `data`.
	 */
	stepReport?: boolean | StepReportSpec;
	/**
	 * CLI tools: programs on this computer, by name (`gh`, `aws`), that the
	 * agent may run in its shell without a prompt. In `plan` mode nothing
	 * runs, so they add nothing. How each harness allows them: see
	 * `cliAllowRules` (Claude Code) and `opencodePermission`. Codex cannot
	 * allow one command: its sandbox decides.
	 */
	clis?: string[];
	/** MCP servers by name, added to the harness's own configuration. */
	mcpServers?: Record<string, McpServerConfig>;
	/**
	 * Keeps a file for the person: an artifact of the run. With it, a
	 * session that can use tools gets the `save_artifact` tool (see
	 * `artifact-tool.ts`). `path` is what the agent gives: relative to
	 * `cwd`, or absolute. Returns the tool's answer to the agent. Throws
	 * when the file cannot be kept; the agent gets the error.
	 */
	saveArtifact?: (file: { path: string; title?: string }) => Promise<string>;
	/** Aborting stops the harness process. The stream then ends with an `error` event of kind `aborted`. */
	signal: AbortSignal;
};

/** Where a cost came from: the harness said it, or Night Shift priced the tokens. */
export type CostSource = "reported" | "estimated";

export type AgentUsage = {
	/** Every input token, the cached ones included. */
	inputTokens: number;
	outputTokens: number;
	/** The part of `inputTokens` read from the prompt cache, when the harness says. */
	cacheReadTokens?: number;
	/** The part of `inputTokens` written to the prompt cache, when the harness says. */
	cacheWriteTokens?: number;
	/** The part of `cacheWriteTokens` kept for an hour, which costs more. */
	cacheWrite1hTokens?: number;
	/** What the harness itself says the session cost. */
	costUsd?: number;
};

/** An outcome name: `pass`, `fail`, `needs-input`, or one of the spec's outcomes. */
export type StepReportOutcome = string;

export type StepReportSpec = {
	/** The outcomes the agent may report. Default: pass, fail, needs-input. */
	outcomes?: { name: string; description?: string }[];
	/**
	 * A JSON Schema for the report's `data`. The tool's input schema carries
	 * it, so the model sees it. The harness does not validate the data; the
	 * engine does.
	 */
	output?: Record<string, unknown>;
	/**
	 * `false`: the agent reports its summary (and data) but no outcome,
	 * because something else picks it (an Agent node's checker). The
	 * report's `outcome` is then "". Default: true.
	 */
	outcome?: boolean;
};

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
	| {
			type: "tool-result";
			toolCallId: string;
			content: string;
			/** The harness marked the result as an error. Absent otherwise. */
			isError?: true;
	  }
	/** The agent's step report. When the agent reports twice, the last one counts. */
	| {
			type: "report";
			outcome: StepReportOutcome;
			summary: string;
			/** Present when the spec has an output schema (not yet validated). */
			data?: unknown;
	  }
	/**
	 * What the session has used so far: a running total, not a step. Only
	 * harnesses that report usage while they work send it (Claude Code,
	 * OpenCode, ACP agents that send `usage_update`). `finished` has the total.
	 */
	| { type: "usage"; usage: AgentUsage }
	| { type: "finished"; usage?: AgentUsage }
	| {
			type: "error";
			kind: AgentErrorKind;
			message: string;
			/** Epoch ms when a usage limit resets, when the harness reports it. */
			resetAt?: number;
	  };

export interface AgentHarness {
	/** A built-in harness, or a custom agent (`acp:<slug>`). */
	readonly name: AgentHarnessName;
	/** The display name, for example "Claude Code". */
	readonly label: string;
	/** Start or resume one session. Never throws: failures end the stream with an `error` event. */
	run(input: AgentSessionInput): AsyncIterable<AgentEvent>;
	/**
	 * The CLI command a person runs to take over this session in the
	 * terminal, with the id quoted for the shell. Null when the CLI has none.
	 */
	takeOverCommand(sessionId: string): string | null;
}

export type DecisionInput = {
	/** Which decision model answers. */
	decider: DeciderName;
	/** The rendered question with its context. */
	prompt: string;
	labels: { name: string; description?: string }[];
	/** Unset: the decider's default model. */
	model?: string;
	signal: AbortSignal;
};

/** A decision, or why there is none. */
export type DecisionResult =
	| {
			kind: "decided";
			label: string;
			notes: string;
			costUsd: number | null;
			/** Absent: reported, when there is a cost. Null: no cost. */
			costSource?: CostSource | null;
	  }
	| {
			kind: "error";
			/** `aborted` when the signal fired. */
			errorKind: AgentErrorKind;
			message: string;
			costUsd: number | null;
	  };

/** What a Value node made by a model asks: a brief and the JSON Schema its answer must match. */
export type ValueInput = {
	/** Which decider answers. Only one with a text adapter can (`canMakeValue`). */
	decider: DeciderName;
	/** The rendered brief with its context. */
	prompt: string;
	/** A JSON Schema the model's answer is held to. */
	output: Record<string, unknown>;
	/** Unset: the decider's default chat model. */
	model?: string;
	signal: AbortSignal;
};

/** A value, or why there is none. The engine checks `data` against the schema. */
export type ValueResult =
	| {
			kind: "made";
			data: unknown;
			costUsd: number | null;
			/** Absent: reported, when there is a cost. Null: no cost. */
			costSource?: CostSource | null;
	  }
	| {
			kind: "error";
			/** `aborted` when the signal fired. */
			errorKind: AgentErrorKind;
			message: string;
			costUsd: number | null;
	  };

/**
 * Picks one label for a Decision node (`decide()` with a TanStack AI
 * decider) and makes a value for a Value node (`chat()` with an output
 * schema on the decider's text adapter).
 */
export interface Decider {
	/**
	 * The model a node on this decider starts on when it names none: the
	 * decision model, or the text model that makes a value (the decision
	 * model again for a decider without one).
	 */
	defaultModel(decider: DeciderName, makes: "decision" | "value"): string;
	/** Never throws: failures come back as `kind: "error"`. */
	decide(input: DecisionInput): Promise<DecisionResult>;
	/** Never throws. A decider that cannot make a value answers `kind: "error"`. */
	value?(input: ValueInput): Promise<ValueResult>;
}
