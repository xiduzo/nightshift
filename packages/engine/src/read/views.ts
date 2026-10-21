import type {
	Flow,
	FlowNodeType,
	ItemState,
	JsonValue,
} from "@nightshift/flows";
import type { RunCommandKind } from "../contract";
import type {
	GateChoice,
	ResumeAction,
	ResumedBy,
	RunStatus,
	RunTrigger,
	RunWarningKind,
	SessionOutcome,
	StepOutcome,
	TranscriptEntry,
} from "../log";
import type { VariableChange } from "./derive-steps";

/**
 * The run views the engine returns: a run, its steps, sessions and items,
 * its warnings and resumes, and an open Gate. Each is derived from the
 * event log (`read-model.ts`), never stored.
 */

export type SessionSummary = {
	id: string;
	harnessSessionId: string | null;
	prompt: string;
	createdAt: number;
	/** Set when the session ended. */
	outcome: SessionOutcome | null;
	error: string | null;
	/** What the session cost, or has spent so far while it runs. */
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
	/** Sessions and model calls that ended. With none, nothing could cost. */
	costCalls: number;
	/** The Device the step ran on (its Placement). Null for steps from before Devices named it. */
	device: RunDevice | null;
	/**
	 * A Decision decided by a person (a Gate): what it asked, once it
	 * opened. Null for every other step. With `outcome` null, the Gate
	 * waits in the Needs-you inbox.
	 */
	gate: {
		question: string;
		choices: GateChoice[];
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
	/** Sessions and model calls that ended. With none, nothing could cost. */
	costCalls: number;
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
	/** Sessions and model calls that ended. With none, nothing could cost. */
	costCalls: number;
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
	by: ResumedBy;
	/** The node the walk continued at. */
	nodeId: string;
	/** Why the daemon resumed the run. Null for a person. */
	reason: string | null;
	/**
	 * `resume`: the run continued where it stopped. `restart`: a person
	 * stopped the running step and continued it at once. `rerun`: a person
	 * ran the flow again from `nodeId`.
	 */
	action: "resume" | ResumeAction;
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
	/** Every value each variable took, in every flow the run ran, oldest first. */
	variables: VariableChange[];
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

/** A Gate that waits for a person. */
export type OpenGate = {
	/** The Space of the run: the inbox lists the Gates of every Space a person is in. */
	spaceId: string;
	runId: string;
	runTitle: string;
	projectId: string;
	projectName: string;
	stepId: string;
	nodeId: string;
	/** The rendered question. */
	question: string;
	choices: GateChoice[];
	/**
	 * The flow author let a person answer this Gate from the lock screen: a
	 * notification may show its options as buttons. Otherwise the answer
	 * needs the app.
	 */
	lockScreen: boolean;
	openedAt: number;
	walker: RunWalker;
	/** An answer is on its way to the Walker. */
	answerPending: boolean;
};

export type RunStreamItem =
	| { kind: "transcript"; entry: TranscriptEntry }
	| { kind: "status"; status: RunStatus }
	/** A step started or ended. Sent with its latest summary. */
	| { kind: "step"; step: StepSummary };
