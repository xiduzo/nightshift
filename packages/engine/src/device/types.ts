import type {
	AgentEvent,
	AgentHarnessName,
	AgentSessionInput,
	DeciderName,
	DecisionInput,
	DecisionResult,
	ValueInput,
	ValueResult,
} from "@nightshift/agents/types";
import type {
	FlowSources,
	JsonValue,
	ProfileSettings,
} from "@nightshift/flows";
import type { KnowledgeRequest } from "../knowledge";
import type { WorktreeChanges } from "../log";

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
	/** Whether it takes work now. */
	state(): Promise<DeviceState>;
	/** What a run start checks before it writes anything. */
	capabilities(query?: CapabilityQuery): Promise<Capabilities>;
	/**
	 * The project's flows on this Device, unparsed: its flow document. A
	 * run starts from the flow document of its Walker (`PlanDevices.flows`):
	 * this answers a Walker of an older Night Shift that asks over the
	 * wire. It goes one release after ADR 2.
	 */
	flows(projectId: string): Promise<FlowSources>;
	/**
	 * One harness session. The first item says whether the session can
	 * start: `refused` (the stream ends there) or `ready`; the harness
	 * starts when the next item is read, so a caller records the session
	 * between the two. Then the harness's own events.
	 *
	 * An `OfferedSessionInput` names a profile the Device offers instead
	 * of the harness and its settings: only a Device that serves another
	 * Person's run under its Offers takes one (`@nightshift/devices`, `offers/`).
	 */
	session(
		input: SessionInput | OfferedSessionInput,
	): AsyncIterable<SessionEvent>;
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
	/**
	 * Adds a run's worktree on its own branch, from the project's Clone on
	 * this Device. Refuses a Clone that is not ready for runs (no git, not
	 * the top of a repository, no commit), before it adds anything.
	 */
	worktree(run: RunRef): Promise<Worktree>;
	/**
	 * A Call item's branch in the worktree at `cwd`: `name`, else the first
	 * free `name-2`, `name-3`, …, made at `base` (null: the checked-out
	 * branch, else `fallback`) and checked out. Refuses a dirty worktree.
	 */
	/**
	 * Hands the run's work on (`HandedOff`): refuses a worktree at `cwd`
	 * with changes that are not committed (nothing is committed for you),
	 * then pushes its checked-out branch, and the run's own, to the Clone's
	 * `origin`. Returns the commit and the branch.
	 */
	handOff(input: {
		cwd: string;
		/** The run's own branch, `nightshift/<run8>`. */
		runBranch: string;
	}): Promise<{ commit: string; branch: string }>;
	/**
	 * Takes the run's work: fetches `branch` from the Clone's `origin` and
	 * checks it out at `commit` in the run's worktree on this Device,
	 * added when it has none. Refuses a worktree with uncommitted changes.
	 */
	receiveHandOff(input: {
		run: RunRef;
		branch: string;
		commit: string;
	}): Promise<Worktree>;
	itemBranch(input: {
		cwd: string;
		name: string;
		base: string | null;
		fallback: string;
	}): Promise<{ branch: string; base: string }>;
	/**
	 * A snapshot of the files in the run's worktree at `cwd`: what is
	 * staged, what is not, and the new files git does not ignore, as the id
	 * of a git tree. Nothing in the worktree, its index or its branch
	 * changes. Refuses a worktree with too many new files. Absent: this
	 * Device does not tell what a step changed (a test's), and a step shows
	 * only its agent's own edits. A Device of an older Night Shift refuses
	 * the call.
	 */
	snapshotWorktree?(input: {
		cwd: string;
		signal?: AbortSignal;
	}): Promise<{ tree: string }>;
	/**
	 * What changed in the worktree at `cwd` since the snapshot `from`: a new
	 * snapshot, and each file that differs, with its diff up to the limits
	 * (`projects/worktree-changes.ts`). Present when `snapshotWorktree` is.
	 */
	worktreeChanges?(input: {
		cwd: string;
		from: string;
		signal?: AbortSignal;
	}): Promise<WorktreeChanges>;
};

export type DeviceState = { online: boolean };

/** What a run start asks a Device about, besides what it always reports. */
export type CapabilityQuery = {
	/** The programs to look for on the Device (CLI tools by name). */
	programs?: readonly string[];
	/** The profiles (Agent and Model Profiles) to look up on the Device, by id. */
	profiles?: readonly string[];
};

export type Capabilities = {
	/**
	 * The Device's name when it is not this computer, so a refusal says
	 * where ("… on hetzner-1"). Null: this computer.
	 */
	elsewhere: string | null;
	/** The harnesses added (the Agents page) and built. */
	harnesses: AgentHarnessName[];
	/** The connections defined (Agents → Tools). */
	connections: string[];
	/** The CLI tools defined (Agents → Tools). */
	clis: string[];
	/** Where each asked program is on the Device, or null when it has none. */
	programs: Record<string, string | null>;
	/** The asked profiles the Device defines, by id; one it lacks is left out. */
	profiles: Record<string, ProfileSettings>;
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
	| "mcpServers"
	| "clis"
	| "prompt"
	| "saveArtifact"
	| "toolsPath"
	| "env"
	| "scrubEnv"
	// The Device adds Night Shift's own (the knowledge tools) itself.
	| "tools"
	| "toolsInstruction"
	// The assistant's, not a run step's: it runs on this computer only.
	| "readOnly"
	// The Device adds the knowledge folder itself (`knowledge`).
	| "addDirs"
	| "instructions"
> & {
	harness: AgentHarnessName;
	/** The node's prompt. The Device adds what a new session learns about its CLI tools. */
	prompt: string;
	/**
	 * CLI tools by name. The Device runs each with its own login, through
	 * a launcher it makes for the session (`tool-launchers.ts`).
	 */
	clis?: string[];
	/** Connections by name: the Device expands them with its own secrets. */
	connections?: string[];
	/**
	 * The step the session runs for: the agent keeps artifacts of it with
	 * `save_artifact`. The Device that runs the session keeps them.
	 */
	artifacts?: { runId: string; stepId: string };
	/**
	 * The project whose knowledge folder the session gets on the Device
	 * that runs it: in `NS_KNOWLEDGE`, and to read with a line that says
	 * where, when it has files or `always` (`knowledge/project-knowledge.ts`).
	 * Absent: the node turned it off (`knowledge: false`).
	 */
	knowledge?: KnowledgeRequest;
};

/**
 * A session of an Agent Profile the Device offers to the run's Space (an
 * Offer). The Walker does not know the profile's settings: the Device
 * that runs it resolves the profile itself, as its owner set it.
 * `permissionMode` is what the node asks for; the Offer's cap bounds it.
 */
export type OfferedSessionInput = Omit<
	SessionInput,
	"harness" | "model" | "permissionMode" | "effort" | "clis" | "connections"
> & {
	offered: {
		profile: string;
		permissionMode?: SessionInput["permissionMode"];
	};
};

export type SessionEvent =
	| AgentEvent
	/** `harness`: what runs the session, for an offered profile the Walker cannot resolve. */
	| { type: "ready"; harness?: AgentHarnessName }
	/** The session cannot start; the message says why, for the person. */
	| { type: "refused"; message: string };

export type ExecInput = {
	command: string;
	cwd: string;
	/** Added to the Device's environment. */
	env?: Record<string, string>;
	/**
	 * Secrets by name: the Device reads each from its own secrets and adds
	 * it to the environment under that name. Their values never leave the
	 * Device: the output it yields has them as `•••`.
	 */
	secrets?: string[];
	/**
	 * Gives the command a new, empty file for its data, named in the
	 * environment variable `NS_OUTPUT` (a Command step). The `exit` event
	 * hands back what the command wrote there, and the file goes.
	 */
	outputFile?: boolean;
	/**
	 * The project whose knowledge folder the command gets in
	 * `NS_KNOWLEDGE`, made on the Device when it is not there yet: a sync
	 * flow writes into it.
	 */
	knowledge?: { projectId: string };
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
			/**
			 * With `outputFile`: what the command wrote to `NS_OUTPUT`, with
			 * secret values as `•••`. Empty when it wrote nothing.
			 */
			output?: string;
	  }
	/**
	 * The command did not run: the Device does not have a secret it names.
	 * The only event; the message says why, for the person.
	 */
	| { type: "refused"; message: string };

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
	/** The project: the worktree branches from its Clone on the Device. */
	projectId: string;
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
