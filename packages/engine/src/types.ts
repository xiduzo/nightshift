import type {
	AgentEvent,
	AgentHarness,
	Decider,
	HarnessName,
} from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import type {
	AgentNode,
	AgentProfileSettings,
	Flow,
	FlowIssue,
	FlowListItem,
	FlowNodeType,
	ItemState,
	JsonValue,
	LoadedFlow,
	Outcome,
	Schedule,
	ScheduleIssue,
} from "@nightshift/flows";

import type { CliToolGuide } from "./cli-tools";
import type { McpExpansion } from "./mcp";
import type { RunSettings } from "./settings";

/**
 * The engine's public contract. The API layer only calls this interface.
 * A run walks a flow, and the flows it calls, in one worktree.
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
	/**
	 * The node's template outputs, for example `log_tail` or `summary`. JSON
	 * values: an Agent's `data` and a For Each's `results` hold objects.
	 */
	outputs: Record<string, JsonValue>;
	error: string | null;
	/**
	 * Set when the step ran inside a called flow: the Subflow or For Each
	 * step that called it, and (For Each) the element. Null at the top level.
	 */
	scope: { parentStepId: string; itemId: string | null } | null;
	/** For Each steps only: the items of this visit, in the order they started. */
	items: ItemSummary[];
	/** Agent steps only. Several when a person resumed the step or a wait continued it. */
	sessions: SessionSummary[];
	costUsd: number;
	/**
	 * A Decision decided by a person (a Gate): what it asked, once it
	 * opened. Null for every other step. With `outcome` null, the Gate
	 * waits in the Needs-you inbox.
	 */
	gate: {
		question: string;
		choices: { name: string; description?: string }[];
		openedAt: number;
	} | null;
};

/** One item of a For Each visit. */
export type ItemSummary = {
	id: string;
	title: string;
	url: string | null;
	/** The element as the source gave it. */
	value: JsonValue;
	state: ItemState;
	/** Null when the For Each does not use a branch per item. */
	branch: string | null;
	baseBranch: string | null;
	startedAt: number;
	endedAt: number | null;
	/** Why it failed or is blocked, or which label halted it. */
	reason: string | null;
};

/** What started a run: a person, or a schedule of `.nightshift/schedules.json`. */
export type RunTrigger =
	| { kind: "manual" }
	/** `at`: the cron time the run started for (epoch ms). */
	| { kind: "schedule"; scheduleId: string; at: number };

export type RunSummary = {
	id: string;
	projectId: string;
	trigger: RunTrigger;
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
	/** When a sleeping run continues. Null while it waits for a signal with no timeout. */
	wakeAt: number | null;
	/** The signal a sleeping run waits for (a Wait node), else null. */
	signal: string | null;
	/** The values of the top-level flow's inputs, defaults applied. */
	inputs: Record<string, JsonValue>;
	/** The stop time: no new step starts after it. */
	stopAt: number | null;
	/** Set when a person asked to stop after the running step. */
	stopAfterStep: boolean;
	createdAt: number;
	/** When the run ended. Null while it is running, waiting or sleeping, or when it never ended. */
	endedAt: number | null;
	/** Sum over all steps. */
	costUsd: number;
};

/** A resume of a run: by a person, or by the daemon after a restart. */
export type RunResume = {
	at: number;
	by: "person" | "daemon";
	/** The node the walk continued at. */
	nodeId: string;
	/** Why the daemon resumed the run. Null for a person. */
	reason: string | null;
};

export type RunDetail = RunSummary & {
	/** The copy of the flow taken when the run started. Edits to the file do not change it. */
	flow: Flow;
	/** Copies of every flow the run can call (Subflow and For Each), by name, taken at start. */
	calledFlows: Record<string, Flow>;
	/** In the order they started. */
	steps: StepSummary[];
	/** How often the run took each edge, by edge id. */
	traversals: Record<string, number>;
	/** The resume command for the last harness session, to take over in a terminal. */
	takeOverCommand: string | null;
	/** Every resume, oldest first. */
	resumes: RunResume[];
};

/** What a Decision step decided by a model writes to its transcript. */
export type DecisionEvent =
	| { type: "decision-start"; prompt: string; labels: string[]; model: string }
	| { type: "decision"; label: string; notes: string };

/**
 * What a Decision step decided by a rule writes to its transcript: the
 * option that matched (null when none did) and what each rule gave, in
 * order, up to the match. A default option (no rule) gives null.
 */
export type RuleEvent = {
	type: "rule";
	matched: string | null;
	evaluated: { option: string; result: JsonValue | null }[];
};

/** What a Decision step decided by a person (a Gate) writes to its transcript. */
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

/**
 * A wait of the run policy, or of a Wait node, written to the transcript of
 * the step that waits. `until` is null for a signal with no timeout;
 * `signal` names the signal a Wait node waits for, or the one that woke it.
 */
export type WaitEvent =
	| {
			type: "wait";
			reason:
				| "usage-limit"
				| "network"
				| "duration"
				| "time"
				| "command"
				| "signal";
			until: number | null;
			message: string;
			signal?: string;
	  }
	| { type: "wake"; signal?: string };

/** What a command step writes to its transcript. */
export type CommandEvent =
	| { type: "command-start"; command: string }
	| { type: "command-output"; stream: "stdout" | "stderr"; text: string }
	| { type: "command-exit"; exitCode: number | null };

export type StepEvent =
	| AgentEvent
	| CommandEvent
	| DecisionEvent
	| RuleEvent
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
	 * Values for the flow's `inputs`, by name: a string for a `text` input,
	 * any JSON value (or JSON text) for a `json` input. A missing or empty
	 * value takes the input's default; a required input without either
	 * refuses the start. Names the flow does not declare are refused.
	 */
	inputs?: Record<string, JsonValue>;
	/** Epoch ms. No new step starts after it; the run then ends as stopped. */
	stopAt?: number;
	/** Git ref to branch the worktree from. Defaults to the clone's current HEAD. */
	baseRef?: string;
} & (
	| { flowName: string; flow?: never }
	/** A flow that is not a file, for example a quick run. */
	| { flow: Flow; flowName?: never }
);

/** How the last cron time of a schedule went. */
export type ScheduleResult =
	| {
			kind: "fired";
			/** The cron time (epoch ms). */
			at: number;
			runId: string;
			/** The run's status now. Null when the run is gone. */
			runStatus: RunStatus | null;
	  }
	/** The run did not start, for example the flow has errors or the run cap was reached. */
	| { kind: "failed"; at: number; error: string }
	/** The time was not started: missed while the daemon was down, or an earlier run still runs. */
	| {
			kind: "skipped";
			at: number;
			reason: string;
			/** The earlier run that still ran, when that is the reason. */
			runId: string | null;
	  };

export type ScheduleSummary = Schedule & {
	/** The next start (epoch ms). Null when paused or the cron line does not parse. */
	nextAt: number | null;
	last: ScheduleResult | null;
	/** Problems of this schedule. One with an error fails to start. */
	issues: ScheduleIssue[];
};

export type ScheduleList = {
	/** Absolute path of `.nightshift/schedules.json`. */
	path: string;
	schedules: ScheduleSummary[];
	/** Problems of the whole file, for example JSON that does not parse. */
	issues: ScheduleIssue[];
};

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
	 * The schedules of `.nightshift/schedules.json` in the project's clone,
	 * with the next start and how the last cron time went.
	 */
	listSchedules(projectId: string): Promise<ScheduleList>;
	/**
	 * Writes the schedules file. Saves schedules with problems too; returns
	 * the issues. The scheduler reads the file on its next tick.
	 */
	saveSchedules(
		projectId: string,
		schedules: readonly Schedule[],
	): Promise<ScheduleIssue[]>;
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
	/**
	 * Sends a signal to a run whose Wait node waits for it: the step ends
	 * `done` and the walk goes on. Fails when the run does not wait for a
	 * signal of that name.
	 */
	signalRun(runId: string, name: string): Promise<void>;

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
	/** Root for transcripts, command logs and other on-disk state, for example ~/.nightshift. */
	dataDir: string;
	/** How many runs may run a step at once. A run waiting at a Gate does not count. Default 2. */
	maxConcurrentRuns?: number;
	/** Safety net against runaway flows: the most steps one run may take, unless the flow's policy sets `maxSteps`. Default 500. */
	maxStepsPerRun?: number;
	/**
	 * The scheduler starts the runs of `.nightshift/schedules.json` when
	 * their cron times come due. On by default; `false` turns it off.
	 * Aborting `signal` stops it for good, for example when a hot reload
	 * replaces the engine.
	 */
	scheduler?: false | { signal?: AbortSignal };
	/**
	 * The daemon's settings, read each time one applies: the run cap, the
	 * step cap, the policy defaults and the scheduler switch. Overrides
	 * `maxConcurrentRuns` and `maxStepsPerRun` when set.
	 */
	settings?: () => RunSettings;
	/**
	 * An Agent node's MCP servers: its connections and its own servers, with
	 * `${NAME}` expanded. Default: its own servers, from `process.env`.
	 */
	mcpServersFor?: (
		node: Pick<AgentNode, "connections" | "mcpServers">,
	) => Promise<McpExpansion>;
	/** The connections this daemon has. A flow that names another refuses to start. */
	connectionNames?: () => ReadonlySet<string>;
	/** The CLI tools this daemon has. A flow that names another refuses to start. */
	cliNames?: () => ReadonlySet<string>;
	/**
	 * Where a CLI tool is on this computer, or null. A flow that names one it
	 * cannot find refuses to start. Default: `Bun.which`.
	 */
	findCli?: (name: string) => string | null;
	/**
	 * What an agent learns about its CLI tools: each description and help.
	 * A new agent session gets them at the end of its prompt. Without it the
	 * agent may run them, but nobody tells it they are there.
	 */
	cliToolsFor?: (names: readonly string[]) => Promise<CliToolGuide[]>;
	/**
	 * The harnesses added on the Agents page, read when a run starts and
	 * when a session starts. A harness left out cannot run an Agent node,
	 * even when `harnesses` has it. Without it: every harness in `harnesses`.
	 */
	harnessNames?: () => ReadonlySet<HarnessName>;
	/**
	 * An Agent Profile by name. A run resolves the profiles its Agent nodes
	 * name when it starts; a flow that names a profile this returns null for
	 * refuses to start. Without it, no profile exists.
	 */
	profileFor?: (name: string) => AgentProfileSettings | null;
};
