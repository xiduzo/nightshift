import type {
	AgentEvent,
	AgentHarness,
	Decider,
	GithubItemsInput,
	HarnessName,
} from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import type {
	Flow,
	FlowIssue,
	FlowListItem,
	FlowNodeType,
	ItemState,
	LoadedFlow,
	Outcome,
	SourceItem,
} from "@nightshift/flows";

/**
 * The engine's public contract. The API layer only calls this interface.
 * Slice 2: a run walks a flow of Agent and Command nodes in one worktree.
 */

/** Derived from the event log, never stored. */
export type RunStatus =
	| "running" // a step is in progress, or the walk is between steps
	| "waiting" // a Gate waits for a person in the Needs-you inbox
	| "sleeping" // a usage limit or a network failure: a timer continues the same session
	| "finished" // the walk reached `pass`, a Decision label or a Gate choice with no edge left to take
	| "stopped" // a person stopped the run
	| "failed" // a step errored, a `fail`/`needs-input` had no edge, or a loop hit its max
	| "interrupted"; // the daemon died while a step ran

export type Project = {
	id: string;
	name: string;
	repoPath: string;
	createdAt: number;
};

/**
 * How one visit of a node ended: one of the node's outcomes (`pass`, a
 * Decision label, a Gate choice, …) or one of the reserved values below.
 */
export type StepOutcome =
	| Outcome
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
	/** Set when the step ran inside a For Each body: which For Each step and which item. */
	scope: { forEachStepId: string; itemId: string } | null;
	/** For Each steps only: the items of this visit, in the order they started. */
	items: ItemSummary[];
	/** Agent steps only. Several when a person resumed the step or a wait continued it. */
	sessions: SessionSummary[];
	costUsd: number;
};

/** One item of a For Each visit. */
export type ItemSummary = {
	id: string;
	number: number | null;
	title: string;
	url: string | null;
	state: ItemState;
	/** Null when the For Each does not use a branch per item. */
	branch: string | null;
	baseBranch: string | null;
	startedAt: number;
	endedAt: number | null;
	/** Why it failed or is blocked, or which label halted it. */
	reason: string | null;
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
	/** Why the run failed, or which Decision label or Gate choice ended it. */
	reason: string | null;
	/** When a sleeping run continues. */
	wakeAt: number | null;
	/** The run parameters it started with. */
	params: Record<string, string>;
	/** The stop time: no new step starts after it. */
	stopAt: number | null;
	/** Set when a person asked to stop after the running step. */
	stopAfterStep: boolean;
	createdAt: number;
	/** Sum over all steps. */
	costUsd: number;
};

export type RunDetail = RunSummary & {
	/** The copy of the flow taken when the run started. Edits to the file do not change it. */
	flow: Flow;
	/** Copies of the For Each body flows, by flow name, taken at start. */
	bodyFlows: Record<string, Flow>;
	/** In the order they started. */
	steps: StepSummary[];
	/** How often the run took each edge, by edge id. */
	traversals: Record<string, number>;
	/** The resume command for the last harness session, to take over in a terminal. */
	takeOverCommand: string | null;
};

/** What a Decision step writes to its transcript. */
export type DecisionEvent =
	| { type: "decision-start"; prompt: string; labels: string[]; model: string }
	| { type: "decision"; label: string; notes: string };

/** What a Gate step writes to its transcript. */
export type GateEvent =
	| {
			type: "gate-open";
			question: string;
			choices: { name: string; description?: string }[];
	  }
	| { type: "gate-resolved"; choice: string; note: string };

/** What a For Each step writes to its transcript. */
export type ForEachEvent =
	| { type: "items-read"; count: number; open: number }
	| {
			type: "item-start";
			itemId: string;
			title: string;
			branch: string | null;
			baseBranch: string | null;
	  }
	| {
			type: "item-end";
			itemId: string;
			state: ItemState;
			reason: string | null;
	  };

/** A wait of the run policy, written to the transcript of the step that waits. */
export type WaitEvent =
	| {
			type: "wait";
			reason: "usage-limit" | "network";
			until: number;
			message: string;
	  }
	| { type: "wake" };

/** What a command step writes to its transcript. */
export type CommandEvent =
	| { type: "command-start"; command: string }
	| { type: "command-output"; stream: "stdout" | "stderr"; text: string }
	| { type: "command-exit"; exitCode: number | null };

export type StepEvent =
	| AgentEvent
	| CommandEvent
	| DecisionEvent
	| GateEvent
	| ForEachEvent
	| WaitEvent;

/** A Gate that waits for a person. */
export type OpenGate = {
	runId: string;
	runTitle: string;
	projectId: string;
	projectName: string;
	stepId: string;
	nodeId: string;
	/** The rendered question. */
	question: string;
	choices: { name: string; description?: string }[];
	openedAt: number;
};

/**
 * One line of a step's transcript file. `seq` increases by one per run,
 * across steps and sessions.
 */
export type TranscriptEntry = {
	seq: number;
	stepId: string;
	/** The engine's agent session id. Null for other steps. */
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
	/**
	 * Values for the flow's `params`, by name. A missing or empty value takes
	 * the param's default; a required param without either refuses the start.
	 * Names the flow does not declare are refused.
	 */
	params?: Record<string, string>;
	/** Epoch ms. No new step starts after it; the run then ends as stopped. */
	stopAt?: number;
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

	/** Open Gates over all runs, oldest first. The Needs-you inbox. A Gate stays open across daemon restarts. */
	listGates(): Promise<OpenGate[]>;
	/**
	 * Answers an open Gate with one of its choices and continues the walk on
	 * that outcome. Fails when the step is not an open Gate or the choice is
	 * not one of its choices.
	 */
	resolveGate(input: {
		runId: string;
		stepId: string;
		choice: string;
		note?: string;
	}): Promise<void>;

	listRuns(input?: { projectId?: string }): Promise<RunSummary[]>;
	getRun(runId: string): Promise<RunDetail>;

	/**
	 * Validates the flow (refuses one with errors), snapshots it, creates the
	 * worktree, starts walking at the start node, and returns at once.
	 */
	startRun(input: StartRunInput): Promise<RunSummary>;
	/**
	 * `now` (default): aborts the running step, closes an open Gate or ends a
	 * sleep, and ends the run as `stopped`. `after-step`: lets the running
	 * step finish, then ends the run as `stopped` before the next step.
	 * No-op when nothing runs, waits or sleeps.
	 */
	stopRun(
		runId: string,
		options?: { when?: "now" | "after-step" },
	): Promise<void>;
	/**
	 * Continues a stopped, failed or interrupted run at its last step's node
	 * (inside a For Each, at the same item). A sleeping run wakes at once.
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
	/** Decides Decision nodes. A flow with a Decision node fails to start without one. */
	decider?: Decider;
	/** Reads GitHub For Each sources. A flow with one fails to start without it. */
	readGithubItems?: (input: GithubItemsInput) => Promise<SourceItem[]>;
	/** Root for transcripts, command logs and other on-disk state, for example ~/.nightshift. */
	dataDir: string;
	/** How many runs may run a step at once. A run waiting at a Gate does not count. Default 2. */
	maxConcurrentRuns?: number;
	/** Safety net against runaway flows: the most steps one run may take. Default 50. */
	maxStepsPerRun?: number;
};
