import type {
	AgentEvent,
	AgentHarness,
	HarnessName,
} from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import type {
	Flow,
	FlowIssue,
	FlowListItem,
	FlowNodeType,
	LoadedFlow,
	Outcome,
} from "@nightshift/flows";

/**
 * The engine's public contract. The API layer only calls this interface.
 * Slice 2: a run walks a flow of Agent and Command nodes in one worktree.
 */

/** Derived from the event log, never stored. */
export type RunStatus =
	| "running" // a step is in progress, or the walk is between steps
	| "finished" // the walk reached a `pass` outcome with no edge left to take
	| "stopped" // a person stopped the run
	| "failed" // a step errored, a `fail`/`needs-input` had no edge, or a loop hit its max
	| "interrupted"; // the daemon died while a step ran

export type Project = {
	id: string;
	name: string;
	repoPath: string;
	createdAt: number;
};

/** How one visit of a node ended. */
export type StepOutcome =
	| Outcome // the node finished and produced an outcome
	| "error" // the harness or the command could not run, or the step timed out
	| "stopped" // a person stopped the run
	| "interrupted"; // the daemon died while the step ran

export type SessionSummary = {
	id: string;
	harnessSessionId: string | null;
	prompt: string;
	createdAt: number;
	/** Set when the session ended. */
	outcome: "finished" | "stopped" | "failed" | "interrupted" | null;
	error: string | null;
	costUsd: number | null;
};

/** One visit of one node. */
export type StepSummary = {
	id: string;
	nodeId: string;
	nodeType: FlowNodeType;
	/** 1 for the first visit of this node in the run, 2 for the second, … */
	visit: number;
	startedAt: number;
	endedAt: number | null;
	/** Null while the step runs. */
	outcome: StepOutcome | null;
	/** The node's template outputs, for example `log_tail` or `summary`. */
	outputs: Record<string, string | number>;
	error: string | null;
	/** Agent steps only. Several when a person resumed the step. */
	sessions: SessionSummary[];
	costUsd: number;
};

export type RunSummary = {
	id: string;
	projectId: string;
	/** The flow file the run started from. Null for a quick run. */
	flowName: string | null;
	/** The flow name, or the prompt of a quick run. */
	title: string;
	worktreePath: string;
	branch: string;
	baseRef: string;
	status: RunStatus;
	/** Why the run failed, when it did. */
	reason: string | null;
	createdAt: number;
	/** Sum over all steps. */
	costUsd: number;
};

export type RunDetail = RunSummary & {
	/** The copy of the flow taken when the run started. Edits to the file do not change it. */
	flow: Flow;
	/** In the order they started. */
	steps: StepSummary[];
	/** How often the run took each edge, by edge id. */
	traversals: Record<string, number>;
	/** The resume command for the last harness session, to take over in a terminal. */
	takeOverCommand: string | null;
};

/** What a command step writes to its transcript. */
export type CommandEvent =
	| { type: "command-start"; command: string }
	| { type: "command-output"; stream: "stdout" | "stderr"; text: string }
	| { type: "command-exit"; exitCode: number | null };

export type StepEvent = AgentEvent | CommandEvent;

/**
 * One line of a step's transcript file. `seq` increases by one per run,
 * across steps and sessions.
 */
export type TranscriptEntry = {
	seq: number;
	stepId: string;
	/** The engine's agent session id. Null for command steps. */
	sessionId: string | null;
	at: number;
	event: StepEvent;
};

export type RunStreamItem =
	| { kind: "transcript"; entry: TranscriptEntry }
	| { kind: "status"; status: RunStatus }
	/** A step started or ended. Sent with its latest summary. */
	| { kind: "step"; step: StepSummary };

export type StartRunInput = {
	projectId: string;
	/** Git ref to branch the worktree from. Defaults to the clone's current HEAD. */
	baseRef?: string;
} & (
	| { flowName: string; flow?: never }
	/** A flow that is not a file, for example a quick run. */
	| { flow: Flow; flowName?: never }
);

export interface Engine {
	listProjects(): Promise<Project[]>;
	/** Fails when the path is not the top level of a git repository. */
	addProject(input: { repoPath: string; name?: string }): Promise<Project>;
	/** Keeps the project's runs and events. Fails while one of its runs is running. */
	removeProject(projectId: string): Promise<void>;

	/** The flow files in the project's clone, `.nightshift/flows/*.json`. */
	listFlows(projectId: string): Promise<FlowListItem[]>;
	getFlow(projectId: string, name: string): Promise<LoadedFlow>;
	/** Saves drafts with errors too. Returns the issues of the saved flow. */
	saveFlow(projectId: string, name: string, flow: Flow): Promise<FlowIssue[]>;
	deleteFlow(projectId: string, name: string): Promise<void>;

	listRuns(input?: { projectId?: string }): Promise<RunSummary[]>;
	getRun(runId: string): Promise<RunDetail>;

	/**
	 * Validates the flow (refuses one with errors), snapshots it, creates the
	 * worktree, starts walking at the start node, and returns at once.
	 */
	startRun(input: StartRunInput): Promise<RunSummary>;
	/** Aborts the running step and ends the run as `stopped`. No-op when nothing runs. */
	stopRun(runId: string): Promise<void>;
	/**
	 * Continues a stopped, failed or interrupted run at its last step's node.
	 * An Agent node with a harness session continues that session with the
	 * prompt (default "Continue where you left off."). Any other node runs
	 * again. Edge counts carry over. Fails while the run is running.
	 */
	resumeRun(runId: string, prompt?: string): Promise<void>;

	/**
	 * Emits the current status and every step summary, replays the full
	 * transcript from disk (oldest first), then yields live items until the
	 * signal aborts. `afterSeq` skips transcript entries the caller already has.
	 */
	watchRun(
		runId: string,
		options: { signal: AbortSignal; afterSeq?: number },
	): AsyncIterable<RunStreamItem>;
}

export type EngineOptions = {
	db: Database;
	harnesses: Partial<Record<HarnessName, AgentHarness>>;
	/** Root for transcripts, command logs and other on-disk state, for example ~/.nightshift. */
	dataDir: string;
	/** How many runs may run a step at once. Default 2. */
	maxConcurrentRuns?: number;
	/** Safety net against runaway flows: the most steps one run may take. Default 50. */
	maxStepsPerRun?: number;
};
