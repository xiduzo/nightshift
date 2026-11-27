import type { AgentHarnessName } from "@nightshift/agents/types";
import type {
	AskForm,
	FlowNodeType,
	GateUrgency,
	ItemState,
	JsonValue,
	NodeOutputs,
} from "@nightshift/flows";
import type { RunResult, RunStatus } from "../../run-status";
import type {
	AnsweredBy,
	EnginePayloads,
	GateBrief,
	GateChoice,
	GateDeadline,
	InputValues,
	ItemFacts,
	RunEnding,
	RunEndReason,
	Scope,
	StandIn,
	StepOutcome,
	StepOutputs,
	StepRung,
	StoppedBy,
	TestRun,
	WaitReason,
} from "../events";
import type { CostTally } from "./cost";
import type { Hold } from "./holds";

/**
 * The run state: one fold of a run's event log, events in, state out.
 *
 * Every reader of a run reads this state: the read model's views, the run
 * trace, the run metrics, the copy stamps and the walk's own questions
 * (where a run is, what it spent, which step sleeps). This module is the
 * one place that decides what an event means for a run. Among others:
 *
 * - The run's status is a folded fact (`status`), with the end that stands
 *   (`end`), the Gates it waits at (`gates`, `gate`) and the wait it sleeps
 *   in (`sleep`). The latest of `RunStarted`, `RunResumed` and `RunEnded`
 *   decides: an end gives its status; else the run is `waiting` while a
 *   Gate is open, `sleeping` while a step waits for a usage limit, the
 *   network or a Device, and `running` otherwise. A run with no run event
 *   (the daemon died while it created the run) is `interrupted`.
 * - A step opens when it starts (`StepStarted`) and again at each reopen
 *   (`StepReopened`). A second `StepStarted` of the same step is a new
 *   opening too, and its start facts replace the earlier ones. Each opening
 *   keeps its own end: the first `StepEnded` after it. A later duplicate
 *   end changes nothing, and neither its cost, its outputs nor its
 *   variables count.
 * - A `WaitStarted` on a step that has ended counts for nothing: it is the
 *   late write of a daemon that died.
 * - A step sleeps from its `WaitStarted` to its `WaitEnded`, its end or its
 *   reopen. A Gate of the step waits from its `GateOpened` to the step's end
 *   or reopen. A `GateOpened` while the Gate still waits opens no second
 *   wait. Every run-level event (a start, a resume, an end) closes both.
 * - A Gate's answer (a `Scored` on its step) answers the step's latest
 *   Gate wait.
 * - A session belongs to the step it started in, and to the opening of the
 *   step it started in: the part of the step whose end tells it. So do a
 *   sleep and a Gate's wait.
 *
 * Nothing here is stored: the log is the only source. The run log keeps
 * one state per run and applies each appended event to it (`nextState`),
 * so a read never walks the log again.
 */

/** A harness session, as the log tells it. */
export type DerivedSession = {
	id: string;
	stepId: string | null;
	prompt: string;
	resumeSessionId: string | null;
	harness: AgentHarnessName;
	harnessSessionId: string | null;
	/** The model the harness said it runs, once it said it. */
	model: string | null;
	startedAt: number;
	startSeq: number;
	/** The index in its step's `openings` of the opening it started in. Null without a step. */
	opening: number | null;
	/** When it ended (its first `SessionEnded`). Null while it runs, or when it never ended. */
	endedAt: number | null;
	/** When the log last heard of it: its latest event. */
	lastAt: number;
	/** The first end wins: a late duplicate never rewrites history. */
	ending: EnginePayloads["SessionEnded"] | null;
	/** The last running total (`SessionUsage`), or null. */
	spent: EnginePayloads["SessionUsage"] | null;
};

/** One item of a Call step's visit (`each`), as the log tells it. */
export type DerivedItem = {
	facts: ItemFacts;
	/** 1-based among the started items; null for an item that was blocked. */
	index: number | null;
	/**
	 * `running` only while the Call step runs. An item whose Call step
	 * step ended (stopped, failed, interrupted) before the item did shows
	 * `failed` with the reason; `open` still tells that the item never ended.
	 */
	state: ItemState;
	/** No `ItemEnded` yet: a resume continues this item. */
	open: boolean;
	branch: string | null;
	baseBranch: string | null;
	/** The called flow's input values. Null before flow format 2. */
	inputs: InputValues | null;
	/** The called flow's declared outputs for this element, once it ended. */
	outputs: StepOutputs;
	startedAt: number;
	endedAt: number | null;
	reason: string | null;
};

/** A time span of a step. `to` is null while it lasts. */
export type StepSleep = { from: number; to: number | null };

/** A time span of a step in the opening (its index in `openings`) it began in. */
type PartSpan = StepSleep & { opening: number };

/**
 * A time a Gate of the step waited for a person, what it asked, and who
 * chose its option and which (the Gate's answer score). `answeredBy` and
 * `answer` are null while nobody did, or when the run stopped while it
 * waited.
 */
export type GateWait = PartSpan & {
	/** The rendered question of the `GateOpened` that began the wait. */
	question: string;
	/** How soon it needed an answer (ADR 21). `today` in logs from before. */
	urgency: GateUrgency;
	/** The options it offered, so an answered Gate can show the one it took among them. */
	choices: GateChoice[];
	/** Its brief (ADR 21): empty in logs from before. */
	brief: GateBrief;
	/** What the model that wrote its brief cost. Absent: no model was asked. */
	briefCost?: CostTally;
	answeredBy: AnsweredBy | null;
	/** The option it took (the score's label). */
	answer: string | null;
	/** When its option was chosen (the score's time). Absent while nobody chose one. */
	answeredAt?: number;
	/** An Ask (ADR 10): the Gate had a form to fill in. Absent on every other Gate. */
	ask?: true;
};

/** A time a step slept, and what for: a reason, and the signal of a Wait node on one (else null). */
export type SleepSpan = PartSpan & {
	reason: WaitReason;
	signal: string | null;
};

/** The end of one opening of a step. */
export type StepEnd = {
	seq: number;
	at: number;
	payload: EnginePayloads["StepEnded"];
	/** What the step spent itself at this end (a decider). */
	cost: CostTally;
};

/** One opening of a step: its start, or a reopen. */
export type StepOpening = {
	kind: "start" | "reopen";
	seq: number;
	at: number;
	/** What the reopen tells the step's session. Null for a start, and without a session. */
	prompt: string | null;
	/** The first `StepEnded` after this opening. Null while it is open. */
	end: StepEnd | null;
};

export type DerivedStep = {
	id: string;
	nodeId: string;
	nodeType: FlowNodeType;
	visit: number;
	scope: Scope | null;
	transcriptPath: string;
	logPath: string | null;
	/** The Device the step ran on (its Placement). Null before steps named it. */
	deviceId: string | null;
	/** Another Device took this step over while the run walked (ADR 17). */
	moved?: true;
	/**
	 * Where the step stands on its node's ladder, as its `StepStarted` says.
	 * Absent for a step on no ladder, and for a step of an older Walker.
	 */
	rung?: StepRung;
	/**
	 * The step stood in for its node in a test run (ADR 27), as its
	 * `StepStarted` says. Absent: the node ran.
	 */
	test?: StandIn;
	/**
	 * A pinned step: the step of an earlier run its output comes from
	 * (`RunStarted.test`). Absent for every other step.
	 */
	pinnedFrom?: { runId: string; stepId: string; endedAt: number };
	/** Its latest `StepStarted`. */
	startedAt: number;
	startSeq: number;
	/** The seq of the latest opening (`StepStarted` or `StepReopened`). */
	openedSeq: number;
	/** Every opening, oldest first, each with its end. */
	openings: readonly StepOpening[];
	/** The end of the latest opening. Null while the step runs (also after a reopen). */
	endedAt: number | null;
	outcome: StepOutcome | null;
	/** The outputs of the latest end since its latest start, else `{ visit }`. */
	outputs: StepOutputs;
	error: string | null;
	sessions: readonly DerivedSession[];
	/** Harness sessions plus what the step spent itself at each end (a decider). */
	cost: CostTally;
	/**
	 * Gate steps, and an Agent step while it asks a person: the latest
	 * `GateOpened` of this step. Null again once the step reopens.
	 */
	gate: {
		question: string;
		choices: GateChoice[];
		/** How soon it needs an answer (ADR 21). */
		urgency: GateUrgency;
		/** Why a person decides, what is done, what the flow recommends (ADR 21). */
		brief: GateBrief;
		/** The flow author let a person answer this Gate from the lock screen. */
		lockScreen: boolean;
		openedAt: number;
		openedSeq: number;
		/** When nobody answered by then, the Gate takes an option. Null without one. */
		deadline: GateDeadline | null;
		/** An Ask (ADR 10): the form the answer fills in. Null on every other Gate. */
		form: AskForm | null;
		/**
		 * An answer that waits for the drive (`AnswerQueued`), until the Gate
		 * takes it or a `RunWarned` `answer-dropped` says it did not.
		 */
		queued: EnginePayloads["AnswerQueued"] | null;
		/** Why the latest answer that waited did not reach this Gate (`answer-dropped`). Null until one did not. */
		dropped: string | null;
	} | null;
	/** When the step slept (a Wait node, a usage limit, the network), oldest first. */
	sleeps: readonly SleepSpan[];
	/** When a Gate of the step waited for a person, oldest first. */
	gateWaits: readonly GateWait[];
	/** Call steps with `each` only: its items in the order they started or were blocked. */
	items: readonly DerivedItem[];
	/** What the step's agents searched and read in the project's knowledge, oldest first. */
	knowledge: readonly KnowledgeUseFact[];
	/** Call steps (once) only: the call, once its inputs were bound. */
	call: EnginePayloads["FlowCalled"] | null;
	/**
	 * The step's time budget (from its latest opening) and when it counts
	 * from: the latest of its openings, a `WaitEnded` or `ItemStarted` of
	 * its own, and every event inside it (a step of the flow it calls, an
	 * edge there). A Call node enters again after each wait, Gate and
	 * element in its called flow, and the log has no mark of that entry:
	 * the events inside stand in for it. So `since` can be late, never early.
	 */
	clock: { timeoutMs: number | null; idleMs: number | null; since: number };
};

/** A search or a read of the project's knowledge by an agent of a step, as the log tells it. */
export type KnowledgeUseFact =
	| ({ type: "KnowledgeSearched" } & Logged<"KnowledgeSearched">)
	| ({ type: "KnowledgeRead" } & Logged<"KnowledgeRead">);

/** One value a variable took in a run, from the log. */
export type VariableChange = {
	/** The flow invocation the variable belongs to: null for the run's top-level flow. */
	scope: Scope | null;
	name: string;
	value: JsonValue;
	/** The step whose write set it; null for the value the flow started with. */
	stepId: string | null;
	/** A start value an earlier run kept (`keep`), not the variable's `initial`. */
	kept?: true;
	at: number;
};

/** An event of the log as the run state keeps it: its seq, time, step and payload. */
export type Logged<T extends keyof EnginePayloads> = {
	seq: number;
	at: number;
	stepId: string | null;
	payload: EnginePayloads[T];
};

/** The edges taken in one scope, in the order they were taken. */
export type ScopeEdges = {
	scope: Scope | null;
	taken: readonly Logged<"EdgeTaken">[];
};

/**
 * A stop of the run (`RunState.stops`): a stop now (`StopRequested`), or a
 * stop after the running step that nobody withdrew.
 */
export type StopFact = {
	seq: number;
	at: number;
	/** Who stopped it. Null in older logs: a person did. */
	by: StoppedBy | null;
	/** The stop of a restart. False in older logs: the `RunResumed` after it tells. */
	restart: boolean;
	/** A stop after the running step (`StopAfterStepRequested`), not a stop now. */
	afterStep: boolean;
};

/** A wait that ended before its time (`WaitEnded` with `early`), and what its step slept for. Null: the log does not say. */
export type EarlyWake = Logged<"WaitEnded"> & { reason: WaitReason | null };

/** One end of the run: the walk from `openedAt` (its start or a resume) to `at`. */
export type RunEndFact = Logged<"RunEnded"> & { openedAt: number };

/** The end that stands: the run's latest `RunEnded`, with why it ended. */
export type RunEnd = {
	seq: number;
	at: number;
	status: RunEnding;
	reason: string | null;
	/** The status of the End node that ended the run, else null. */
	result: RunResult | null;
	/** Why it ended, as its code. */
	endReason: RunEndReason;
};

/** A Gate the run waits at, as the log tells it. */
export type OpenGateFact = {
	stepId: string;
	nodeId: string;
	visit: number;
	question: string;
	choices: GateChoice[];
	/** How soon it needs an answer (ADR 21). */
	urgency: GateUrgency;
	/** Why a person decides, what is done, what the flow recommends (ADR 21). */
	brief: GateBrief;
	/** The flow author let a person answer this Gate from the lock screen. */
	lockScreen: boolean;
	openedAt: number;
	/** When nobody answered by then, the Gate takes an option. Null without one. */
	deadline: GateDeadline | null;
	/** An Ask (ADR 10): the form the answer fills in. Null on every other Gate. */
	form: AskForm | null;
	/**
	 * A step on another branch of the run still works. An answer waits
	 * until that step ends (`AnswerQueued`).
	 */
	branchesWork: boolean;
	/** An answer waits for the drive: the Gate takes no second one. */
	answerQueued: boolean;
	/** Why the latest answer that waited did not reach this Gate, while it still waits. */
	answerDropped: string | null;
};

/** The wait the run sleeps in, as the log tells it. */
export type SleepFact = {
	stepId: string;
	reason: WaitReason;
	/** When the step continues; null while it waits for a signal with no timeout. */
	until: number | null;
	message: string;
	/** The signal the step waits for, else null. */
	signal: string | null;
	/** The key a webhook signal must have to wake it, else null: any does. */
	signalKey: string | null;
	/** The rules one of which a webhook signal must match to wake it; empty: any does. */
	signalRules: { outcome: string; when: string }[];
};

export type RunState = {
	/** The run of the log: the first event's that names one. */
	runId: string | null;
	/** The seq of the latest event folded in. */
	lastSeq: number;
	/**
	 * When the run last did something: the time of the latest event folded
	 * in that is not feedback (`Scored`). A rating or the fate of a pull
	 * request comes days later and is no work of the run. Null for an empty log.
	 */
	lastAt: number | null;
	/**
	 * The run's status. An end gives its status; a run with no run event is
	 * `interrupted`; else `waiting` with a Gate open, `sleeping` in a wait,
	 * `running` otherwise.
	 */
	status: RunStatus;
	/** The end that stands. Null while the run is open, or has no run event. */
	end: RunEnd | null;
	/**
	 * The Gates the run waits at, in the order their steps started: one per
	 * branch that waits. A Gate step that started but never wrote
	 * `GateOpened` (the daemon died in between) is not open: recovery
	 * interrupts it like any other step. Empty once the run ended.
	 */
	gates: readonly OpenGateFact[];
	/** The Gate the run waits at: the latest of `gates`, or null. */
	gate: OpenGateFact | null;
	/**
	 * The wait the run sleeps in: the latest `WaitStarted` of the current
	 * walk with no `WaitEnded` after it, on a step that is still open, while
	 * the run has not ended. Null otherwise.
	 */
	sleep: SleepFact | null;
	/** The run's first `RunStarted`. */
	started: Logged<"RunStarted"> | null;
	/** The latest `RunStarted`, `RunResumed` or `RunEnded`. */
	latest: { seq: number; at: number } | null;
	/** The latest `RunStarted` or `RunResumed`: when the current walk began. */
	walk: { seq: number; at: number } | null;
	/** The budget counts what was spent after this seq: the run's start, or a person's latest resume. -1 before. */
	budgetFrom: number;
	/** Every end of the run, oldest first. */
	ends: readonly RunEndFact[];
	resumes: readonly Logged<"RunResumed">[];
	/** How often the daemon resumed the run since it started or a person last resumed it. */
	daemonResumes: number;
	/** When the run stops: from `RunStarted`, unless a resume cleared it. */
	stopAt: number | null;
	/** A person asked to stop after the running step, since the current walk began. */
	stopAfterStep: boolean;
	/** Every stop of the run, oldest first: now, or after the running step when nobody withdrew it. */
	stops: readonly StopFact[];
	/** Every time a person took the run over by hand (`RunTakenOver`), oldest first. */
	takeOvers: readonly Logged<"RunTakenOver">[];
	/** Every wait that ended before its time, oldest first: a person, a signal, or Night Shift woke it. */
	earlyWakes: readonly EarlyWake[];
	/** The steps the current walk started. */
	stepsSinceWalk: number;
	warnings: readonly Logged<"RunWarned">[];
	scores: readonly Logged<"Scored">[];
	/** The latest pull request a step of the run opened. Null until one does. */
	pullRequest: { url: string; at: number } | null;
	/**
	 * The run works in a run folder of its own on each Device, not in a
	 * copy of the project (`RunStarted.runFolder`, ADR 22).
	 */
	runFolder: boolean;
	/**
	 * A test run's pins and skips (`RunStarted.test`, ADR 27): the run keeps
	 * nothing that lasts. Null: a run where every node runs.
	 */
	test: TestRun | null;
	/** The latest `WorktreeCreated`: for a run folder, its folder on the run's Device. */
	worktree: EnginePayloads["WorktreeCreated"] | null;
	/** Where the run's work went: each `WorktreeCreated` and `HandedOff`, oldest first. */
	moves: readonly (
		| ({ kind: "created" } & Logged<"WorktreeCreated">)
		| ({ kind: "handed-off" } & Logged<"HandedOff">)
	)[];
	/** The edges taken, by scope key, in the order of each scope's first edge. */
	edges: ReadonlyMap<string, ScopeEdges>;
	/** The latest edge taken in any scope. */
	lastEdge: Logged<"EdgeTaken"> | null;
	/** The `WaitStarted` of each step that still sleeps, oldest first: parallel branches may sleep at once. */
	waits: readonly Logged<"WaitStarted">[];
	/** The variables of each scope, by scope key. */
	variables: ReadonlyMap<string, Record<string, JsonValue>>;
	/** Every value each variable took, in every scope, oldest first. */
	variableChanges: readonly VariableChange[];
	/** The outputs of the latest end of each node, by scope key. */
	nodeOutputs: ReadonlyMap<string, NodeOutputs>;
	/** How many steps each node started, by `visitKey`. */
	visits: ReadonlyMap<string, number>;
	/** The steps in the order they started. */
	steps: ReadonlyMap<string, DerivedStep>;
	/** The sessions in the order they started. */
	sessions: ReadonlyMap<string, DerivedSession>;
	/** What the current walk holds for a scope (leases, services), oldest first. Empty once the run ended. */
	holds: readonly Hold[];
	/** What the run held when it last ended: a resume takes it again. Empty once it resumed. */
	endedHolding: readonly Hold[];
};

/** The key of a node's visit count in one scope (`RunState.visits`). */
export function visitKey(nodeId: string, key: string): string {
	return `${key}\n${nodeId}`;
}
