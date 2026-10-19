import type {
	AgentEvent,
	AgentSessionInput,
	DeciderName,
	DecisionInput,
	DecisionResult,
	HarnessName,
	ValueInput,
	ValueResult,
} from "@nightshift/agents/types";
import type { AgentNode, JsonValue } from "@nightshift/flows";

/**
 * The Device port: what a step body needs from a computer, as one
 * interface. `localDevice` (`device/local.ts`) is this computer; a remote
 * adapter makes the same calls through the Host to another Device.
 *
 * Every input and output is plain data, an `AbortSignal`, or an async
 * iterable of plain data, so a call can cross a wire. Values that must not
 * leave a Device stay on it: the input names connections and carries
 * `${NAME}` references, and the Device expands them where its tools start.
 */
export type Device = {
	/** Stable across restarts: what `StepStarted.deviceId` records. */
	id: string;
	/** What its owner calls it, for example the host name. */
	name: string;
	state(): DeviceState;
	/** What a run start checks before it writes anything. */
	capabilities(query?: CapabilityQuery): Capabilities;
	/**
	 * One harness session. The first item says whether the session can
	 * start: `refused` (the stream ends there) or `ready`; the harness
	 * starts when the next item is read, so a caller records the session
	 * between the two. Then the harness's own events.
	 */
	session(input: SessionInput): AsyncIterable<SessionEvent>;
	/** One `sh -c` in `cwd`: every chunk of output, then exactly one `exit`. */
	exec(input: ExecInput): AsyncIterable<ExecEvent>;
	/** One `tools/call` on a connection's MCP server. Never throws. */
	callTool(input: ToolCallInput): Promise<ToolResult>;
	/**
	 * Asks the decider: a label for a Decision, data for a Value. Never
	 * throws: a failure is `kind: "error"`.
	 */
	decide(input: DecisionInput): Promise<DecisionResult>;
	decide(input: ValueInput): Promise<ValueResult>;
	/** Adds a run's worktree on its own branch, from the clone at `repoPath`. */
	worktree(run: RunRef): Promise<Worktree>;
};

export type DeviceState = { online: boolean };

/** What a run start asks a Device about, besides what it always reports. */
export type CapabilityQuery = {
	/** The programs to look for on the Device (CLI tools by name). */
	programs?: readonly string[];
};

export type Capabilities = {
	/** The harnesses added (the Agents page) and built. */
	harnesses: HarnessName[];
	/** The connections defined (Agents → Tools). */
	connections: string[];
	/** The CLI tools defined (Agents → Tools). */
	clis: string[];
	/** Where each asked program is on the Device, or null when it has none. */
	programs: Record<string, string | null>;
	/** The decider, when one is configured. */
	decider: DeciderFacts | null;
};

export type DeciderFacts = {
	/** Whether it makes values (a Value node made by a model). */
	values: boolean;
	/** The model a node on each decider starts on when it names none. */
	defaultModels: Record<DeciderName, { decision: string; value: string }>;
};

export type SessionInput = Omit<
	AgentSessionInput,
	"mcpServers" | "clis" | "prompt"
> & {
	harness: HarnessName;
	/** The node's prompt. The Device adds what a new session learns about its CLI tools. */
	prompt: string;
	clis?: string[];
	/** Connections by name: the Device expands them with its own secrets. */
	connections?: string[];
	/** The node's own MCP servers, with `${NAME}` references as written. */
	mcpServers?: AgentNode["mcpServers"];
};

export type SessionEvent =
	| AgentEvent
	| { type: "ready" }
	/** The session cannot start; the message says why, for the person. */
	| { type: "refused"; message: string };

export type ExecInput = {
	command: string;
	cwd: string;
	/** Added to the Device's environment. */
	env?: Record<string, string>;
	/** Aborting kills the whole process group (SIGTERM, then SIGKILL). */
	signal: AbortSignal;
};

export type ExecEvent =
	| { type: "output"; stream: "stdout" | "stderr"; text: string }
	| {
			type: "exit";
			/** Null when the process did not exit normally (killed, or never spawned). */
			exitCode: number | null;
			/** Set when the command could not start at all. */
			spawnError: string | null;
	  };

export type ToolCallInput = {
	connection: string;
	tool: string;
	/** The rendered arguments; the Device types them by the tool's input schema. */
	arguments: Record<string, JsonValue>;
	signal: AbortSignal;
};

export type ToolResult =
	/** The Device has no such connection, or cannot fill its secrets: nothing was called. */
	| { kind: "refused"; message: string }
	/** The tool answered (it may report an error itself). */
	| {
			kind: "called";
			/** The arguments as the tool got them. */
			arguments: Record<string, JsonValue>;
			text: string;
			structuredContent: Record<string, unknown> | null;
			isError: boolean;
	  }
	/** The server has no such tool, or did not answer (or the signal aborted). */
	| {
			kind: "failed";
			message: string;
			/** The arguments the call was about to send; null when it got no further than listing. */
			arguments: Record<string, JsonValue> | null;
	  };

/** A run, as the Device that holds its worktree sees it. */
export type RunRef = {
	id: string;
	/** The clone the worktree branches from. */
	repoPath: string;
	/** Default: the clone's current HEAD. */
	baseRef?: string;
	/**
	 * The git identity of the Person who started the run: the worktree's
	 * own `user.name` and `user.email`, so commits in it are in their name.
	 * Absent: the repository's identity stays.
	 */
	author?: GitAuthor;
};

export type GitAuthor = { name: string; email: string };

export type Worktree = {
	worktreePath: string;
	branch: string;
	baseRef: string;
};
