import type { AgentHarnessName } from "@nightshift/agents/types";
import type {
	FlowNodeType,
	ItemState,
	JsonValue,
	NodeOutputs,
} from "@nightshift/flows";
import {
	addCost,
	type CostTally,
	NO_COST,
	sessionCost,
	stepEndCost,
} from "./cost";
import {
	type EnginePayloads,
	type GateChoice,
	type GateDeadline,
	type InputValues,
	type ItemFacts,
	type LoggedEvent,
	type Scope,
	type StepOutcome,
	type StepOutputs,
	scopeKey,
	type WaitReason,
} from "./events";
import { type Hold, sameService } from "./holds";
import { type AnsweredBy, answeredBy } from "./scores";

/**
 * The run state: one fold of a run's event log, events in, state out.
 *
 * Every reader of a run reads this state: the read model's views, the run
 * trace, the run metrics, the copy stamps and the walk's own questions
 * (where a run is, what it spent, which step sleeps). This module is the
 * one place that decides what an event means for a run. Among others:
 *
 * - A step opens when it starts (`StepStarted`) and again at each reopen
 *   (`StepReopened`). A second `StepStarted` of the same step is a new
 *   opening too, and its start facts replace the earlier ones. Each opening
 *   keeps its own end: the first `StepEnded` after it. A later duplicate
 *   end changes nothing, and neither its cost, its outputs nor its
 *   variables count.
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
 * A time a Gate of the step waited for a person, and who chose its option
 * (the Gate's answer score). Null: nobody did yet, or the run stopped
 * while it waited.
 */
export type GateWait = PartSpan & { answeredBy: AnsweredBy | null };

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
		/** The flow author let a person answer this Gate from the lock screen. */
		lockScreen: boolean;
		openedAt: number;
		openedSeq: number;
		/** When nobody answered by then, the Gate takes an option. Null without one. */
		deadline: GateDeadline | null;
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

/** One end of the run: the walk from `openedAt` (its start or a resume) to `at`. */
export type RunEndFact = Logged<"RunEnded"> & { openedAt: number };

export type RunState = {
	/** The run of the log: the first event's that names one. */
	runId: string | null;
	/** The seq of the latest event folded in. */
	lastSeq: number;
	/** The run's first `RunStarted`. */
	started: Logged<"RunStarted"> | null;
	/** The latest `RunStarted`, `RunResumed` or `RunEnded`; `ended` when it is a `RunEnded`. */
	latest: {
		seq: number;
		at: number;
		ended: EnginePayloads["RunEnded"] | null;
	} | null;
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
	/** The steps the current walk started. */
	stepsSinceWalk: number;
	warnings: readonly Logged<"RunWarned">[];
	scores: readonly Logged<"Scored">[];
	/** The latest `WorktreeCreated`. */
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
	/** The latest `WaitStarted` of the current walk with no `WaitEnded` of its step after it. */
	wait: Logged<"WaitStarted"> | null;
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

/** The node types of runs from before flow version 4, read as today's. */
const legacyNodeTypes: Readonly<Record<string, FlowNodeType>> = {
	subflow: "call",
	foreach: "call",
};

/** A logged node type as today's `FlowNodeType`: a Subflow and a For Each step are Call steps. */
function nodeTypeOf(logged: string): FlowNodeType {
	return legacyNodeTypes[logged] ?? (logged as FlowNodeType);
}

/** Why an item that was still running ended with its Call step. */
const cutShort: Record<string, string> = {
	stopped: "The run stopped during this item.",
	interrupted: "Night Shift stopped during this item.",
	error: "The step failed during this item.",
};

/** The state of a run whose log is empty. */
function emptyState(): Draft {
	return {
		runId: null,
		lastSeq: Number.NEGATIVE_INFINITY,
		started: null,
		latest: null,
		walk: null,
		budgetFrom: -1,
		ends: [],
		resumes: [],
		daemonResumes: 0,
		stopAt: null,
		stopAfterStep: false,
		stepsSinceWalk: 0,
		warnings: [],
		scores: [],
		worktree: null,
		moves: [],
		edges: new Map(),
		lastEdge: null,
		wait: null,
		variables: new Map(),
		variableChanges: [],
		nodeOutputs: new Map(),
		visits: new Map(),
		steps: new Map(),
		sessions: new Map(),
		holds: [],
		endedHolding: [],
	};
}

/**
 * A state being folded. Its lists and maps are its own, so `apply` may
 * change them. The records in them (a step, a session) are never changed:
 * a change replaces the record, so a state handed out stays as it was.
 */
type Draft = {
	-readonly [K in keyof RunState]: RunState[K] extends ReadonlyMap<
		infer Key,
		infer Value
	>
		? Map<Key, Value>
		: RunState[K] extends readonly (infer Item)[]
			? Item[]
			: RunState[K];
};

/** A draft with lists and maps of its own, over the records of `state`. */
function draftOf(state: RunState): Draft {
	return {
		...state,
		ends: [...state.ends],
		resumes: [...state.resumes],
		warnings: [...state.warnings],
		scores: [...state.scores],
		moves: [...state.moves],
		edges: new Map(state.edges),
		variables: new Map(state.variables),
		variableChanges: [...state.variableChanges],
		nodeOutputs: new Map(state.nodeOutputs),
		visits: new Map(state.visits),
		steps: new Map(state.steps),
		sessions: new Map(state.sessions),
		holds: [...state.holds],
		endedHolding: [...state.endedHolding],
	};
}

/** The run state of a run's events (any order: they are folded by seq). */
export function foldRun(events: readonly LoggedEvent[]): RunState {
	let ordered = events;
	for (let i = 1; i < events.length; i++) {
		if ((events[i] as LoggedEvent).seq < (events[i - 1] as LoggedEvent).seq) {
			ordered = [...events].sort((a, b) => a.seq - b.seq);
			break;
		}
	}
	const draft = emptyState();
	for (const e of ordered) apply(draft, e);
	return draft;
}

/**
 * The run state after one more event, or null when `e` is not the latest
 * (its seq is not past the state's): the caller folds the log again.
 * `state` itself does not change.
 */
export function nextState(state: RunState, e: LoggedEvent): RunState | null {
	if (e.seq <= state.lastSeq) return null;
	const draft = draftOf(state);
	apply(draft, e);
	return draft;
}

function logged<E extends LoggedEvent>(
	e: E,
): { seq: number; at: number; stepId: string | null; payload: E["payload"] } {
	return { seq: e.seq, at: e.at, stepId: e.stepId, payload: e.payload };
}

/** The step with its derived fields set again from its openings, sessions and items. */
function settle(step: DerivedStep): DerivedStep {
	const current = step.openings.at(-1);
	const end = current?.end ?? null;
	let outputs: StepOutputs = { visit: step.visit };
	for (let i = step.openings.length - 1; i >= 0; i--) {
		const opening = step.openings[i] as StepOpening;
		if (opening.end) {
			outputs = opening.end.payload.outputs;
			break;
		}
		if (opening.kind === "start") break;
	}
	let cost = NO_COST;
	for (const opening of step.openings) {
		if (opening.end) cost = addCost(cost, opening.end.cost);
	}
	for (const session of step.sessions)
		cost = addCost(cost, sessionCost(session));
	const endedAt = end?.at ?? null;
	const outcome = end?.payload.outcome ?? null;
	return {
		...step,
		openedSeq: current?.seq ?? step.startSeq,
		endedAt,
		outcome,
		outputs,
		error: end?.payload.error ?? null,
		cost,
		items: step.items.map((item) => {
			if (!item.open) return item;
			const state: ItemState = endedAt === null ? "running" : "failed";
			const reason =
				endedAt === null
					? null
					: (cutShort[outcome ?? ""] ?? cutShort.error ?? null);
			return item.state === state &&
				item.reason === reason &&
				item.endedAt === endedAt
				? item
				: { ...item, state, reason, endedAt };
		}),
	};
}

/** Closes the open span at the end of `spans` at `at`, or gives `spans` back. */
function closeLast<T extends StepSleep>(
	spans: readonly T[],
	at: number,
): readonly T[] {
	const last = spans.at(-1);
	if (!last || last.to !== null) return spans;
	return [...spans.slice(0, -1), { ...last, to: at }];
}

function apply(run: Draft, e: LoggedEvent): void {
	run.lastSeq = e.seq;
	run.runId ??= e.runId;
	switch (e.type) {
		case "RunStarted":
		case "RunResumed":
		case "RunEnded":
			applyRunEvent(run, e);
			return;
		case "RunWarned":
			run.warnings.push(logged(e));
			break;
		case "LeaseTaken":
			run.holds = [
				...run.holds.filter(
					(hold) => !(hold.kind === "lease" && hold.name === e.payload.name),
				),
				{
					kind: "lease",
					name: e.payload.name,
					nodeId: e.payload.nodeId,
					scope: e.payload.scope ?? null,
					section: e.payload.section ?? null,
					ttlMinutes: e.payload.ttlMinutes,
					at: e.at,
				},
			];
			break;
		case "LeaseReleased":
			run.holds = run.holds.filter(
				(hold) => !(hold.kind === "lease" && hold.name === e.payload.name),
			);
			break;
		case "ServiceStarted":
			run.holds = [
				...run.holds.filter((hold) => !sameService(hold, e.payload)),
				{
					kind: "service",
					nodeId: e.payload.nodeId,
					scope: e.payload.scope ?? null,
					section: e.payload.section ?? null,
					deviceId: e.payload.deviceId,
					cwd: e.payload.cwd,
					logPath: e.payload.logPath,
					pid: e.payload.pid,
					startedAt: e.payload.startedAt,
					spec: e.payload.spec,
					at: e.at,
				},
			];
			break;
		case "ServiceStopped":
			run.holds = run.holds.filter((hold) => !sameService(hold, e.payload));
			break;
		case "Scored":
			run.scores.push(logged(e));
			break;
		case "StopAfterStepRequested":
			run.stopAfterStep = true;
			break;
		case "StopAfterStepCancelled":
			run.stopAfterStep = false;
			break;
		case "WorktreeCreated":
			run.worktree = e.payload;
			run.moves.push({ kind: "created", ...logged(e) });
			break;
		case "HandedOff":
			run.moves.push({ kind: "handed-off", ...logged(e) });
			break;
		case "EdgeTaken": {
			const key = scopeKey(e.payload.scope);
			const scope = e.payload.scope
				? {
						parentStepId: e.payload.scope.parentStepId,
						itemId: e.payload.scope.itemId,
					}
				: null;
			const edges = run.edges.get(key);
			const taken = logged(e);
			run.edges.set(key, {
				scope: edges?.scope ?? scope,
				taken: [...(edges?.taken ?? []), taken],
			});
			run.lastEdge = taken;
			break;
		}
		case "VariablesSet": {
			const key = scopeKey(e.payload.scope);
			run.variables.set(key, {
				...run.variables.get(key),
				...e.payload.values,
			});
			const kept = new Set(e.payload.kept ?? []);
			for (const [name, value] of Object.entries(e.payload.values)) {
				run.variableChanges.push({
					scope: e.payload.scope ?? null,
					name,
					value,
					stepId: null,
					...(kept.has(name) ? { kept: true as const } : {}),
					at: e.at,
				});
			}
			break;
		}
		case "WaitStarted":
			run.wait = logged(e);
			break;
		case "WaitEnded":
			if (run.wait && run.wait.stepId === e.stepId) run.wait = null;
			break;
	}
	if (e.sessionId) applySessionEvent(run, e, e.sessionId);
	if (e.stepId) applyStepEvent(run, e, e.stepId);
	enterCallers(run, e);
}

function applyRunEvent(
	run: Draft,
	e: Extract<LoggedEvent, { type: "RunStarted" | "RunResumed" | "RunEnded" }>,
): void {
	// A stop ends the sleep and the Gate's wait, and a resume goes on awake.
	for (const [id, step] of run.steps) {
		const sleeps = closeLast(step.sleeps, e.at);
		const gateWaits = closeLast(step.gateWaits, e.at);
		if (sleeps !== step.sleeps || gateWaits !== step.gateWaits) {
			run.steps.set(id, { ...step, sleeps, gateWaits });
		}
	}
	run.latest = {
		seq: e.seq,
		at: e.at,
		ended: e.type === "RunEnded" ? e.payload : null,
	};
	run.wait = null;
	if (e.type === "RunEnded") {
		run.ends.push({ ...logged(e), openedAt: run.walk?.at ?? e.at });
		// An ended run holds nothing: the engine let go of it.
		run.endedHolding = run.holds;
		run.holds = [];
		return;
	}
	if (e.type === "RunResumed") run.endedHolding = [];
	run.walk = { seq: e.seq, at: e.at };
	run.stopAfterStep = false;
	run.stepsSinceWalk = 0;
	if (e.type === "RunStarted") {
		run.started ??= logged(e);
		run.stopAt = e.payload.stopAt ?? null;
		run.daemonResumes = 0;
		run.budgetFrom = e.seq;
	} else {
		run.resumes.push(logged(e));
		if (e.payload.clearStopAt) run.stopAt = null;
		const byDaemon = e.payload.by === "daemon";
		run.daemonResumes = byDaemon ? run.daemonResumes + 1 : 0;
		if (!byDaemon) run.budgetFrom = e.seq;
	}
}

function applySessionEvent(
	run: Draft,
	e: LoggedEvent,
	sessionId: string,
): void {
	let session: DerivedSession | undefined;
	if (e.type === "SessionStarted") {
		session = {
			id: sessionId,
			stepId: e.stepId,
			prompt: e.payload.prompt,
			resumeSessionId: e.payload.resumeSessionId,
			harness: e.payload.harness ?? "claude-code",
			harnessSessionId: null,
			model: null,
			startedAt: e.at,
			startSeq: e.seq,
			opening: openingOf(run, e.stepId),
			endedAt: null,
			lastAt: e.at,
			ending: null,
			spent: null,
		};
	} else {
		const known = run.sessions.get(sessionId);
		if (!known) return;
		session = { ...known };
		if (session.endedAt === null) session.lastAt = e.at;
		if (e.type === "HarnessSessionAssigned") {
			session.harnessSessionId ??= e.payload.harnessSessionId;
			session.model ??= e.payload.model;
		} else if (e.type === "SessionUsage") {
			session.spent = e.payload;
		} else if (e.type === "SessionEnded" && session.ending === null) {
			session.ending = e.payload;
			session.endedAt = e.at;
		}
	}
	run.sessions.set(sessionId, session);
	const step = session.stepId ? run.steps.get(session.stepId) : undefined;
	if (!step) return;
	const at = step.sessions.findIndex((s) => s.id === sessionId);
	const sessions =
		at === -1
			? [...step.sessions, session]
			: step.sessions.map((s, i) =>
					i === at ? (session as DerivedSession) : s,
				);
	run.steps.set(step.id, settle({ ...step, sessions }));
}

/** The index of the step's latest opening, or null when the log has no such step. */
function openingOf(run: Draft, stepId: string | null): number | null {
	const step = stepId ? run.steps.get(stepId) : undefined;
	return step ? step.openings.length - 1 : null;
}

function applyStepEvent(run: Draft, e: LoggedEvent, stepId: string): void {
	if (e.type === "StepStarted") {
		startStep(run, e, stepId);
		return;
	}
	const known = run.steps.get(stepId);
	if (!known) return;
	let step: DerivedStep = known;
	if (
		e.type === "WaitEnded" ||
		e.type === "StepEnded" ||
		e.type === "StepReopened"
	) {
		step = { ...step, sleeps: closeLast(step.sleeps, e.at) };
	}
	if (e.type === "StepEnded" || e.type === "StepReopened") {
		step = { ...step, gateWaits: closeLast(step.gateWaits, e.at) };
	}
	const current = step.openings.at(-1);
	switch (e.type) {
		case "KnowledgeSearched":
			step = {
				...step,
				knowledge: [...step.knowledge, { type: e.type, ...logged(e) }],
			};
			break;
		case "KnowledgeRead":
			step = {
				...step,
				knowledge: [...step.knowledge, { type: e.type, ...logged(e) }],
			};
			break;
		case "Scored": {
			const by = answeredBy(e.payload);
			const wait = step.gateWaits.at(-1);
			if (by && wait && wait.answeredBy === null) {
				step = {
					...step,
					gateWaits: [
						...step.gateWaits.slice(0, -1),
						{ ...wait, answeredBy: by },
					],
				};
			}
			break;
		}
		case "WaitStarted": {
			const sleep = step.sleeps.at(-1);
			// A wait logged again in the same sleep (a new daemon) goes on with it.
			if (!sleep || sleep.to !== null) {
				step = {
					...step,
					sleeps: [
						...step.sleeps,
						{
							from: e.at,
							to: null,
							opening: step.openings.length - 1,
							reason: e.payload.reason,
							signal: e.payload.signal ?? null,
						},
					],
				};
			}
			break;
		}
		case "WaitEnded":
		case "ItemStarted":
			step = enteredAt(step, e.at);
			if (e.type === "ItemStarted") {
				step = {
					...step,
					items: [
						...step.items,
						{
							facts: e.payload.item,
							index: e.payload.index,
							state: "running",
							open: true,
							branch: e.payload.branch,
							baseBranch: e.payload.baseBranch,
							inputs: e.payload.inputs ?? null,
							outputs: {},
							startedAt: e.at,
							endedAt: null,
							reason: null,
						},
					],
				};
			}
			break;
		case "GateOpened": {
			const wait = step.gateWaits.at(-1);
			// Asked again while the Gate waits (a new daemon): the same wait.
			if (!wait || wait.to !== null) {
				step = {
					...step,
					gateWaits: [
						...step.gateWaits,
						{
							from: e.at,
							to: null,
							opening: step.openings.length - 1,
							answeredBy: null,
						},
					],
				};
			}
			step = {
				...step,
				gate: {
					question: e.payload.question,
					choices: e.payload.choices,
					lockScreen: e.payload.lockScreen === true,
					openedAt: e.at,
					openedSeq: e.seq,
					deadline: e.payload.deadline ?? null,
				},
			};
			break;
		}
		case "StepReopened":
			step = enteredAt(
				{
					...step,
					openings: [
						...step.openings,
						{ kind: "reopen", seq: e.seq, at: e.at, end: null },
					],
					// A Gate the step asked is closed: an Agent goes on with the answer.
					gate: null,
					clock: clockOf(e.payload, step.clock.since),
				},
				e.at,
			);
			break;
		case "StepEnded":
			// The first end after an opening counts: a late duplicate changes nothing.
			if (!current || current.end) break;
			step = {
				...step,
				openings: [
					...step.openings.slice(0, -1),
					{
						...current,
						end: {
							seq: e.seq,
							at: e.at,
							payload: e.payload,
							cost: stepEndCost(e.payload),
						},
					},
				],
			};
			endedStep(run, step, e);
			break;
		case "FlowCalled":
			step = { ...step, call: e.payload };
			break;
		case "ItemBlocked":
			step = {
				...step,
				items: [
					...step.items,
					{
						facts: e.payload.item,
						index: null,
						state: "blocked",
						open: false,
						branch: null,
						baseBranch: null,
						inputs: null,
						outputs: {},
						startedAt: e.at,
						endedAt: e.at,
						reason: e.payload.reason,
					},
				],
			};
			break;
		case "ItemEnded": {
			const at = step.items.findLastIndex(
				(i) => i.facts.id === e.payload.itemId && i.open,
			);
			if (at !== -1) {
				step = {
					...step,
					items: step.items.map((item, i) =>
						i === at
							? {
									...item,
									open: false,
									state: e.payload.state,
									reason: e.payload.reason,
									outputs: e.payload.outputs ?? {},
									endedAt: e.at,
								}
							: item,
					),
				};
			}
			break;
		}
	}
	if (step !== known) run.steps.set(stepId, settle(step));
}

function clockOf(
	budget: { timeoutMs?: number; idleMs?: number },
	since: number,
): DerivedStep["clock"] {
	return {
		timeoutMs: budget.timeoutMs ?? null,
		idleMs: budget.idleMs ?? null,
		since,
	};
}

function enteredAt(step: DerivedStep, at: number): DerivedStep {
	return at > step.clock.since
		? { ...step, clock: { ...step.clock, since: at } }
		: step;
}

/** The step's node entered at `at`: its clock counts from there. */
function enter(run: Draft, stepId: string, at: number): void {
	const step = run.steps.get(stepId);
	if (!step) return;
	const entered = enteredAt(step, at);
	if (entered !== step) run.steps.set(stepId, entered);
}

/** An event inside a Call step (of a step it calls, at any depth) enters each Call step around it. */
function enterCallers(run: Draft, e: LoggedEvent): void {
	const seen = new Set<string>();
	let caller =
		e.type === "EdgeTaken"
			? e.payload.scope?.parentStepId
			: e.stepId
				? run.steps.get(e.stepId)?.scope?.parentStepId
				: undefined;
	while (caller && !seen.has(caller)) {
		seen.add(caller);
		enter(run, caller, e.at);
		caller = run.steps.get(caller)?.scope?.parentStepId;
	}
}

function startStep(
	run: Draft,
	e: Extract<LoggedEvent, { type: "StepStarted" }>,
	stepId: string,
): void {
	const known = run.steps.get(stepId);
	const scope = e.payload.scope ?? null;
	const opening: StepOpening = {
		kind: "start",
		seq: e.seq,
		at: e.at,
		end: null,
	};
	if (!known) {
		run.stepsSinceWalk += 1;
		const visits = visitKey(e.payload.nodeId, scopeKey(scope));
		run.visits.set(visits, (run.visits.get(visits) ?? 0) + 1);
	}
	run.steps.set(
		stepId,
		settle({
			id: stepId,
			nodeId: e.payload.nodeId,
			nodeType: nodeTypeOf(e.payload.nodeType),
			visit: e.payload.visit,
			scope,
			transcriptPath: e.payload.transcriptPath,
			logPath: e.payload.logPath,
			deviceId: e.payload.deviceId ?? null,
			startedAt: e.at,
			startSeq: e.seq,
			openedSeq: e.seq,
			// A second start of the step is a new opening: what it had stays.
			openings: [...(known?.openings ?? []), opening],
			endedAt: null,
			outcome: null,
			outputs: {},
			error: null,
			sessions: known?.sessions ?? [],
			cost: NO_COST,
			gate: null,
			sleeps: known?.sleeps ?? [],
			gateWaits: known?.gateWaits ?? [],
			items: [],
			knowledge: known?.knowledge ?? [],
			call: null,
			clock: clockOf(e.payload, Math.max(known?.clock.since ?? e.at, e.at)),
		}),
	);
}

/** What a step's end (the first after an opening) writes beyond the step: its outputs and variables. */
function endedStep(
	run: Draft,
	step: DerivedStep,
	e: Extract<LoggedEvent, { type: "StepEnded" }>,
): void {
	const key = scopeKey(step.scope);
	run.nodeOutputs.set(key, {
		...run.nodeOutputs.get(key),
		[step.nodeId]: { ...e.payload.outputs },
	});
	const { variables } = e.payload;
	if (!variables) return;
	run.variables.set(key, { ...run.variables.get(key), ...variables });
	for (const [name, value] of Object.entries(variables)) {
		run.variableChanges.push({
			scope: step.scope,
			name,
			value,
			stepId: step.id,
			at: e.at,
		});
	}
}
