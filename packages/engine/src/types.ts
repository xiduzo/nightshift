import type { AgentEvent } from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import type {
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

import type { DeviceRegistry } from "./device/registry";
import type { WorkRelay } from "./device/remote";
import type { Device } from "./device/types";
import type { RunWarningKind } from "./events";
import type { ArchiveRef } from "./exchange/archive";
import type { RunCommandInput, RunCommandKind } from "./exchange/commands";
import type { EngineExchange } from "./exchange/engine-exchange";
import type { FeedStep } from "./exchange/feeds";
import type { DeviceOffer, OfferCaps, SpaceOffer } from "./offers";
import type { RunSettings } from "./settings";
import type { SpaceDocuments } from "./space/document";
import type { Branches } from "./worktrees";

/**
 * The engine's public contract: `Engine`, and the view of one Space,
 * `SpaceEngine`. A run walks a flow, and the flows it calls, in one worktree.
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
	/**
	 * The folder of the project's Clone on this computer. Null: the project
	 * is not on this computer (another Device of the Space has it); a call
	 * that needs its folder (flows, branches, schedules, a run walked here)
	 * fails until a folder of it is added.
	 */
	repoPath: string | null;
	/** The normalised `origin` (`github.com/acme/app`), null without one. */
	remote: string | null;
	createdAt: number;
	/** The Devices with a Clone of it, from the Space document: this one first. */
	clones: ProjectClone[];
};

/** That a Device has a Clone of a Project. Its path is that Device's own. */
export type ProjectClone = {
	deviceId: string;
	/** The Device's name, as the Space document has it. */
	deviceName: string | null;
	/** This computer. */
	thisDevice: boolean;
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
	/** `costUsd` is estimated from tokens: the harness reported no cost. */
	costEstimated: boolean;
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
	 * values: an Agent's `data` and a Call's `results` hold objects.
	 */
	outputs: Record<string, JsonValue>;
	error: string | null;
	/**
	 * Set when the step ran inside a called flow: the Call step that called
	 * it, and (with `each`) the element. Null at the top level.
	 */
	scope: { parentStepId: string; itemId: string | null } | null;
	/** Call steps with `each` only: the items of this visit, in the order they started. */
	items: ItemSummary[];
	/** Agent steps only. Several when a person resumed the step or a wait continued it. */
	sessions: SessionSummary[];
	costUsd: number;
	/** Part of `costUsd` is estimated from tokens: the harness reported no cost. */
	costEstimated: boolean;
	/** Sessions or model calls that ended without a cost: their spend is not in `costUsd`. */
	costMissing: number;
	/** The Device the step ran on (its Placement). Null for steps from before Devices named it. */
	device: RunDevice | null;
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

/** One item of a Call step's visit (`each`). */
export type ItemSummary = {
	id: string;
	title: string;
	url: string | null;
	/** The element as the source gave it. */
	value: JsonValue;
	state: ItemState;
	/** Null when the Call does not use a branch per item. */
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

/** The Device that walks a run and writes its events. */
export type RunWalker = {
	id: string;
	/** Its name, as this Replica knows it. Null when it knows none. */
	name: string | null;
	/** This computer walks it. Any other Walker's run is read-only here, but for its commands. */
	thisDevice: boolean;
};

/** A Device a run names: the Device its steps run on, or one step's. */
export type RunDevice = RunWalker;

/**
 * A Device a run of a project can be placed on, online, with a Clone of
 * the project: one of the Person's own, or another Person's that offers
 * profiles to the Space.
 */
export type Placement = {
	deviceId: string;
	name: string;
	/** This computer. */
	thisDevice: boolean;
	/**
	 * Another Person's Device: the profiles it offers to the Space, the
	 * only ones a run there may use. Absent for the Person's own Devices.
	 */
	offers?: string[];
};

/** One of a Person's Devices, as placement sees it. */
export type OwnDevice = Placement & {
	/** It takes work now. */
	online: boolean;
	/** It has a Clone of the project. */
	hasClone: boolean;
};

/** A person's action on a run walked elsewhere, waiting for its Walker. */
export type PendingCommand = {
	id: string;
	kind: RunCommandKind;
	createdAt: number;
};

/** A Person as a run names them. `name` is null for a Person this computer does not know. */
export type RunPerson = { id: string; name: string | null };

export type RunSummary = {
	id: string;
	projectId: string;
	walker: RunWalker;
	/**
	 * The Device the run's steps run on and its worktree lives on (its
	 * Placement): the Walker itself, or another Device of the Person who
	 * started it.
	 */
	device: RunDevice;
	trigger: RunTrigger;
	/** The Person who started the run. Null for a schedule, and for runs from before Members. */
	startedBy: RunPerson | null;
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
	/** Part of `costUsd` is estimated from tokens: the harness reported no cost. */
	costEstimated: boolean;
	/** Sessions or model calls that ended without a cost: their spend is not in `costUsd`. */
	costMissing: number;
	/** What went wrong without failing a step, oldest first. */
	warnings: RunWarning[];
	/** The runs of the flows its Call nodes called, in the order they started. */
	subflows: SubflowRun[];
	/**
	 * Every Gate the run asked, also in called flows, oldest first.
	 * `closedAt` is null while the Gate waits for an answer.
	 */
	gates: { openedAt: number; closedAt: number | null }[];
};

/**
 * One run of a called flow inside a run: a Call step once, or one item of
 * a Call step with `each`. It has no row of its own.
 */
export type SubflowRun = {
	flowName: string;
	/** How the call (or the item) ended. While it is open: the run's status. */
	status: RunStatus;
	/** Sum over the steps of the called flow, and of the flows it called. */
	costUsd: number;
	/** Part of `costUsd` is estimated from tokens: the harness reported no cost. */
	costEstimated: boolean;
	/** Sessions or model calls that ended without a cost: their spend is not in `costUsd`. */
	costMissing: number;
	startedAt: number;
	endedAt: number | null;
};

/** Something that went wrong in a run without failing a step. */
export type RunWarning = {
	kind: RunWarningKind;
	/** What happened and what to do, for a person. */
	message: string;
	/** The step and node it is about. Null for the run as a whole. */
	stepId: string | null;
	nodeId: string | null;
	at: number;
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
	/** Copies of every flow the run can call (through Call nodes), by name, taken at start. */
	calledFlows: Record<string, Flow>;
	/** In the order they started. */
	steps: StepSummary[];
	/** How often the run took each edge, by edge id. */
	traversals: Record<string, number>;
	/** The resume command for the last harness session, to take over in a terminal. */
	takeOverCommand: string | null;
	/** Every resume, oldest first. */
	resumes: RunResume[];
	/**
	 * Actions on a run walked elsewhere that its Walker has not applied yet,
	 * oldest first. Known where they wait: on the Host.
	 */
	commands: PendingCommand[];
	/** The run's work moving between Devices (`HandedOff`), oldest first. */
	handOffs: HandOff[];
};

/** The run's work moved from one Device to another before a step there. */
export type HandOff = {
	at: number;
	/** The step that needed the work on `to`. */
	stepId: string | null;
	from: RunDevice;
	to: RunDevice;
	/** The commit that moved. */
	commit: string;
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

/** What a Call step with `each` writes to its transcript. */
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
				| "signal"
				| "device-offline";
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

/**
 * What a Value step writes to its transcript: what it was asked (the
 * expression of a rule, or the rendered prompt and the model), then the
 * value it made, or why it made none (`problem`: the expression failed,
 * the model failed, or the data does not match the output schema).
 */
export type ValueEvent =
	| {
			type: "value-start";
			by: "rule" | "model";
			source: string;
			model: string | null;
	  }
	| { type: "value"; data: JsonValue | null; problem: string | null };

/**
 * What a Tool step writes to its transcript: the call it makes (arguments
 * rendered, never the server's config) and what the tool answered. `data`
 * is the structured content, else the JSON the text holds, else null.
 */
export type ToolEvent =
	| {
			type: "tool-call";
			connection: string;
			tool: string;
			arguments: Record<string, JsonValue>;
	  }
	| {
			type: "tool-called";
			isError: boolean;
			text: string;
			data: JsonValue | null;
	  };

export type StepEvent =
	| AgentEvent
	| CommandEvent
	| DecisionEvent
	| RuleEvent
	| GateEvent
	| ForEachEvent
	| WaitEvent
	| ValueEvent
	| ToolEvent;

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
	walker: RunWalker;
	/** An answer is on its way to the Walker. */
	answerPending: boolean;
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
	/**
	 * The Person who starts the run (their id). Commits in the run's
	 * worktree are in their name. Absent: a schedule, or nobody known.
	 */
	startedBy?: string;
	/**
	 * The Device the run's steps run on, and its worktree's home (its
	 * Placement): one of the starter's Devices with a Clone of the project
	 * (`listPlacements`). Default: this computer.
	 */
	deviceId?: string;
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

/**
 * The engine of this Device. Its background work (the walk, recovery, the
 * scheduler) covers every Space the Device holds, and writes each row with
 * its own Space. What a person does goes through one Space's view.
 */
export interface Engine {
	/**
	 * What a person does in one Space. Nothing it reads, returns or changes
	 * is of another Space: a project or run of another Space is "not found".
	 * `actor` is the Person who acts: an action on a run walked elsewhere
	 * travels to its Walker in their name.
	 */
	space(spaceId: string, actor?: Actor): SpaceEngine;
	/** Run history between this Replica and others: rows, cursors, commands, the archive. */
	readonly exchange: EngineExchange;
	/**
	 * On a Host: the Devices that paired with it, their presence and the
	 * audit of it. Each Person sees their own Devices only (the API's rule).
	 */
	readonly devices: DeviceRegistry;
	/**
	 * Logs a change of a Space's Members in that Space's event log
	 * (`MemberJoined`, `MemberRemoved`, `MemberRoleChanged`), with who made it.
	 */
	logMemberChange(change: MemberChange): Promise<void>;
	/** The Offers of the Spaces: published in their documents, with their audit. */
	readonly offers: EngineOffers;
	/**
	 * A Device is back (its link to this Host took work again): the steps
	 * of the runs this computer walks that sleep because a Device was
	 * offline look again now, instead of at their next try.
	 */
	deviceBack(deviceId: string): Promise<void>;
	/**
	 * Ends the running steps of the runs this computer walks that ran past
	 * their time budget or idle limit, as the run's log records them, when
	 * their own timers did not. For a periodic sweep: a step must be one
	 * minute past its limit.
	 */
	endOverdueSteps(): Promise<void>;
}

/**
 * The Offers as the Space documents publish them. Who may make or
 * withdraw one is the caller's check (the Device's owner, a role that
 * allows `offer.make`); the Device's own entry is the daemon's (its
 * Device document).
 */
export type EngineOffers = {
	/** The Offers a Space lists, every Device's. */
	list(spaceId: string): Promise<SpaceOffer[]>;
	/**
	 * Publishes an Offer (or its new caps) in the Space's document and logs
	 * `OfferMade` there. A Space a Host keeps: through that Host, which
	 * logs it in the name of this Device's owner.
	 */
	publish(
		input: OfferCaps & {
			spaceId: string;
			deviceId: string;
			deviceName: string;
			profile: string;
			by: string | null;
		},
	): Promise<void>;
	/**
	 * Takes an Offer off the Space's document, logs `OfferWithdrawn`, and
	 * stops the runs walked here whose running step is a session under it:
	 * the step ends as stopped. A Space a Host keeps: through that Host.
	 * Nothing to withdraw is no error.
	 */
	withdraw(input: {
		spaceId: string;
		deviceId: string;
		profile: string;
		by: string | null;
	}): Promise<void>;
};

/** A change of a Space's Members, as the auth hooks report it. */
export type MemberChange =
	| {
			kind: "joined";
			spaceId: string;
			personId: string;
			role: string;
			by: string | null;
			invitedBy?: string;
	  }
	| { kind: "removed"; spaceId: string; personId: string; by: string | null }
	| {
			kind: "role";
			spaceId: string;
			personId: string;
			role: string;
			previousRole: string;
			by: string | null;
	  };

/** The engine as a person in one Space sees it: the API layer only calls this. */
export interface SpaceEngine {
	listProjects(): Promise<Project[]>;
	/**
	 * Fails when the path is not the top level of a git repository. A
	 * repository without commits is added; `checkProjectFolder` says what it
	 * still needs, and runs refuse to start until then.
	 */
	addProject(input: { repoPath: string; name?: string }): Promise<Project>;
	/** Keeps the project's runs and events. Fails while one of its runs is running. */
	removeProject(projectId: string): Promise<void>;
	/** Gives the project a new name, for every Member of the Space. */
	renameProject(projectId: string, name: string): Promise<Project>;
	/**
	 * Moves the project to another Space, with its Clones, runs, steps,
	 * sessions and events. Who may move it (in both Spaces) is the caller's
	 * check. Fails while one of its runs is running.
	 */
	moveProject(projectId: string, toSpaceId: string): Promise<void>;

	/**
	 * The Devices a run of the project can run on, for the actor: this
	 * computer when it has a Clone, then their other Devices that are
	 * online and have one. In a Space a Host keeps, the Host answers.
	 */
	listPlacements(projectId: string): Promise<Placement[]>;
	/**
	 * The actor's Devices for a project: this computer first, each with
	 * whether it is online and has a Clone (a node's Device picker).
	 */
	listDevices(projectId: string): Promise<OwnDevice[]>;

	/** The local and remote branches of the project's clone, newest first. A run can start from one. */
	listBranches(projectId: string): Promise<Branches>;

	/**
	 * The flow files in the project's clone, `.nightshift/flows/*.json`:
	 * this computer's, else the Clone of another of the actor's Devices
	 * (read-only here).
	 */
	listFlows(projectId: string): Promise<FlowListItem[]>;
	getFlow(projectId: string, name: string): Promise<LoadedFlow>;
	/** Saves drafts with errors too. Returns the issues of the saved flow. */
	saveFlow(projectId: string, name: string, flow: Flow): Promise<FlowIssue[]>;
	deleteFlow(projectId: string, name: string): Promise<void>;

	/** Open Gates over the Space's runs, oldest first. The Needs-you inbox. A Gate stays open across daemon restarts. */
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
	 * (inside a Call with `each`, at the same item). A sleeping run wakes at once.
	 * An Agent node with a harness session continues that session with the
	 * prompt (default "Continue where you left off."). Any other node runs
	 * again. Edge counts carry over. Fails while the run is running.
	 */
	resumeRun(runId: string, prompt?: string): Promise<void>;
	/**
	 * Moves the run's Walk to another of the actor's Devices (`WalkerMoved`):
	 * this computer archives the run's checkpoint and files and stops
	 * walking it; the new Walker resumes from the archive. Only a run that
	 * is not in the middle of a step. A run walked elsewhere: its Walker
	 * moves it.
	 */
	moveRun(runId: string, toDeviceId: string): Promise<void>;

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

/** Who acts in a Space: the Person of the session. */
export type Actor = { personId: string };

/**
 * What the engine asks of the Hosts this Device links to: the actions on
 * rows another Device owns. The daemon gives it; without it, a run walked
 * elsewhere is read-only.
 */
export type Relay = {
	/**
	 * Hands a person's action on a run walked elsewhere to its Walker,
	 * through the Host. Throws when no Host takes it.
	 */
	command(
		command: RunCommandInput & {
			spaceId: string;
			runId: string;
			walkerId: string;
			personId: string;
		},
	): Promise<void>;
	/** Records this Device's Clone in a Space a Host keeps, through that Host. */
	addClone(input: {
		spaceId: string;
		projectId: string;
		deviceId: string;
		deviceName: string;
	}): Promise<void>;
	/** A file of the archive from the Host that keeps the Space. Null when it has none. */
	archive(ref: ArchiveRef): Promise<string | null>;
	/**
	 * A step's live transcript from the Host that keeps the Space: its
	 * entries after `afterSeq`, then each new one, until the step ends.
	 * Throws when that Host cannot be reached.
	 */
	follow?(
		step: FeedStep,
		afterSeq: number,
		signal: AbortSignal,
	): AsyncIterable<TranscriptEntry>;
	/** Publishes this Device's Offer in a Space a Host keeps, through that Host. */
	offer(
		input: OfferCaps & { spaceId: string; profile: string; deviceName: string },
	): Promise<void>;
	/** Withdraws this Device's Offer from a Space a Host keeps, through that Host. */
	withdrawOffer(input: { spaceId: string; profile: string }): Promise<void>;
	/** Keeps a file of a run this computer walks in the archive of the Host that keeps the Space. */
	archivePut(ref: ArchiveRef, content: string): Promise<void>;
	/**
	 * Starts a run placed on another Device through the Host that keeps
	 * the Space: the Host walks it. Returns the run's id; its rows follow
	 * by the exchange.
	 */
	startRun(
		input: StartRunInput & { spaceId: string; deviceId: string },
	): Promise<{ runId: string }>;
	/**
	 * The actor's Devices, as the Host that keeps the Space knows them:
	 * whether each is online and has a Clone of the project.
	 */
	devices(input: { spaceId: string; projectId: string }): Promise<OwnDevice[]>;
};

export type EngineOptions = {
	db: Database;
	/** The Hosts, for the actions on rows another Device owns. */
	relay?: Relay;
	/**
	 * This computer's Device id (`selfDevice`): the Walker of the runs this
	 * engine starts, and the Device whose Clones it works in. Default: the
	 * database's own Device.
	 */
	walkerId?: string;
	/**
	 * This computer as a Device (`localDevice`): its harnesses, decider,
	 * connections, CLI tools, commands and worktrees. A run's steps run on
	 * it unless the run is placed on another Device.
	 */
	device: Device;
	/**
	 * On a Host: how its runs reach the Devices they are placed on (the
	 * hub those Devices pull their work from). Without it, every run runs
	 * on this computer.
	 */
	work?: WorkRelay;
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
	 * An Agent Profile by name. A run resolves the profiles its Agent nodes
	 * name when it starts; a flow that names a profile this returns null for
	 * refuses to start. Without it, no profile exists.
	 */
	profileFor?: (name: string) => AgentProfileSettings | null;
	/**
	 * This computer's own Offers (its Device document). A run of another
	 * Person placed here may use only those the Space also lists. Without
	 * it, this computer offers nothing.
	 */
	ownOffers?: () => readonly DeviceOffer[];
	/**
	 * Whether a Person's role in a Space lets them use Offers (`offer.use`),
	 * the Host's check before it places another Person's run through one.
	 * Without it, nobody uses Offers here.
	 */
	mayUseOffers?: (spaceId: string, personId: string) => Promise<boolean>;
	/**
	 * The Space documents, where Projects are defined. The daemon passes
	 * the ones the relay serves. Default: new ones over `db`.
	 */
	spaceDocuments?: SpaceDocuments;
};
