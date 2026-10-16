import type {
	AgentErrorKind,
	AgentUsage,
	HarnessName,
} from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema/nightshift";
import type {
	FlowNodeType,
	ItemState,
	JsonValue,
	NodeOutputs,
	Outcome,
} from "@nightshift/flows";

import type {
	RunStatus,
	RunTrigger,
	SessionSummary,
	StepOutcome,
} from "./types";

/**
 * Every fact the engine appends to the event log, and the pure functions
 * that derive state from it. Status, reasons, step summaries, edge counts and
 * node outputs are never stored anywhere else.
 *
 * Checkpoint rule: a fact goes into the log as soon as it happens, and a step
 * is closed (`StepEnded` with its outcome and outputs) before the walk picks
 * the next node. A daemon that dies can always continue from the log.
 *
 * Transcript chunks (text deltas, tool calls, command output) never go here:
 * they live in the NDJSON transcript files.
 */

export type SessionOutcome = NonNullable<SessionSummary["outcome"]>;

/** How a run ended. `running` is never logged: it is the absence of an end. */
export type RunEnding = Exclude<RunStatus, "running">;

/** A step's template outputs: JSON values, so `{{planner.data.tasks}}` can take a path. */
export type StepOutputs = Record<string, JsonValue>;

/** Input values of a flow, by input name. */
export type InputValues = Record<string, JsonValue>;

export type GateChoice = { name: string; description?: string };

/**
 * Where a step runs: null at the top level of the run's flow, or inside a
 * flow that a Subflow or For Each step called. `parentStepId` is that step;
 * `itemId` is the element of a For Each (null for a Subflow). Step ids are
 * unique, so the innermost caller is enough: the caller has a scope of its
 * own, and the chain of scopes leads up to the top level. Logs written
 * before flow format 2 say `forEachStepId`; `parseEventRow` reads them as
 * `parentStepId`.
 */
export type Scope = { parentStepId: string; itemId: string | null };

/** The key that separates node ids, visits, outputs and edge counts per scope. */
export function scopeKey(scope: Scope | null | undefined): string {
	return scope ? `${scope.parentStepId}/${scope.itemId ?? ""}` : "";
}

/** What the engine keeps of a list element when it starts or blocks it. */
export type ItemFacts = {
	id: string;
	title: string;
	url: string | null;
	/** The element as the source gave it. */
	value: JsonValue;
};

export type WaitReason = "usage-limit" | "network";

export type EnginePayloads = {
	ProjectAdded: { projectId: string; name: string; repoPath: string };
	ProjectRemoved: { projectId: string };
	/** `addProject` on the path of a removed project. */
	ProjectRestored: { projectId: string };
	RunStarted: {
		projectId: string;
		flowName: string | null;
		title: string;
		/** The node the walk starts at. */
		start: string;
		/** Epoch ms: no new step or item starts after it. Absent before Slice 4. */
		stopAt?: number | null;
		/** The values of the flow's inputs, defaults applied. Absent before flow format 2. */
		inputs?: InputValues;
		/** Flow format 1: the run parameters. Read as `inputs`. */
		params?: Record<string, string>;
		/** What started the run. Absent before Slice 7: a person. */
		trigger?: RunTrigger;
	};
	WorktreeCreated: { worktreePath: string; branch: string; baseRef: string };
	/** A person continued a stopped, failed or interrupted run. */
	RunResumed: {
		/** The node the walk continues at. */
		nodeId: string;
		/** Set when the walk continues an existing Agent step's session. */
		stepId: string | null;
		prompt: string | null;
		/** The scope of `nodeId`: the called flow (and element) the walk continues in. */
		scope?: Scope | null;
		/** The stop time had passed: a person resumed past it, so it no longer applies. */
		clearStopAt?: boolean;
	};
	/** A new visit of a node. */
	StepStarted: {
		nodeId: string;
		nodeType: FlowNodeType;
		visit: number;
		transcriptPath: string;
		/** Command and For Each steps only. */
		logPath: string | null;
		/** Null (or absent before Slice 4) at the top level. */
		scope?: Scope | null;
	};
	/**
	 * An ended step runs again: an Agent step in a new session of the same
	 * harness session, a Subflow or For Each step to continue its called flow.
	 */
	StepReopened: { prompt: string | null };
	StepEnded: {
		outcome: StepOutcome;
		outputs: StepOutputs;
		error: string | null;
		/**
		 * What the step spent outside harness sessions, for example a
		 * Decision's decider. Harness sessions report their own cost in
		 * `SessionEnded`. Absent in logs written before Slice 3.
		 */
		costUsd?: number | null;
	};
	/**
	 * A Gate step asks a person and waits. The step stays open until a person
	 * answers (`StepEnded` with the choice) or stops the run (`StepEnded` with
	 * `stopped`). An open Gate makes the run `waiting`, and it survives a
	 * daemon restart: it is a fact, not a timer.
	 */
	GateOpened: {
		/** The rendered question. */
		question: string;
		choices: GateChoice[];
	};
	SessionStarted: {
		prompt: string;
		/** The harness session this session continues, on a resume. */
		resumeSessionId: string | null;
		/** Absent in logs from before Slice 8: those sessions ran on Claude Code. */
		harness?: HarnessName;
	};
	HarnessSessionAssigned: { harnessSessionId: string; model: string | null };
	SessionEnded: {
		outcome: SessionOutcome;
		error: string | null;
		errorKind: AgentErrorKind | null;
		usage: AgentUsage | null;
		costUsd: number | null;
		/** Epoch ms when a usage limit resets, when the harness reports it. */
		resetAt: number | null;
	};
	EdgeTaken: {
		edgeId: string;
		from: string;
		to: string;
		outcome: Outcome;
		/** The scope the edge belongs to. Null (or absent) at the top level. */
		scope?: Scope | null;
	};
	/**
	 * A Subflow step calls its flow with these input values (bindings
	 * rendered, defaults applied). The called flow runs in the step's scope.
	 */
	FlowCalled: { flow: string; inputs: InputValues };
	/** A For Each step read its source. */
	ItemsRead: { count: number; open: number };
	/** A For Each step starts an element: its flow runs in the scope of this element. */
	ItemStarted: {
		item: ItemFacts;
		/** 1 for the first item the visit started. */
		index: number;
		/** Null without a branch per item. */
		branch: string | null;
		baseBranch: string | null;
		/**
		 * The input values of the called flow for this element. Absent before
		 * flow format 2: the element was the only input, `item`.
		 */
		inputs?: InputValues;
	};
	/** An item that never starts: a blocker of it failed or is blocked. */
	ItemBlocked: { item: ItemFacts; blocker: string; reason: string };
	ItemEnded: {
		itemId: string;
		state: Exclude<ItemState, "running" | "blocked">;
		reason: string | null;
		/** The called flow's declared outputs for this element. Absent before flow format 2. */
		outputs?: StepOutputs;
	};
	/**
	 * A step waits for a usage limit to reset or for the network. The step
	 * stays open and the run sleeps. A fact, not a timer: a new daemon
	 * rebuilds the timer from it.
	 */
	WaitStarted: {
		reason: WaitReason;
		/** Epoch ms when the step continues. */
		until: number;
		message: string;
		/** Epoch ms of the first wait of this streak (the network grace counts from it). */
		since: number;
	};
	/** The wait is over: the step continues. `early` when a person resumed the run. */
	WaitEnded: { early: boolean };
	StopRequested: Record<string, never>;
	/** A person asked to stop the run before its next step or item. */
	StopAfterStepRequested: Record<string, never>;
	RunEnded: { status: RunEnding; reason: string | null };
	/**
	 * A schedule came due and the scheduler started its run (`runId`), or
	 * tried to and could not (`error`). `at` is the cron time, not the
	 * moment of the tick: no cron time of a schedule fires twice. Logged
	 * without a run id on the row; the run is in the payload.
	 */
	ScheduleFired: {
		projectId: string;
		scheduleId: string;
		at: number;
		runId: string | null;
		error: string | null;
	};
	/**
	 * A cron time of a schedule that did not start: missed by more than the
	 * grace (the daemon was down or the computer slept), or an earlier run
	 * of the same schedule was still running, waiting or sleeping.
	 */
	ScheduleSkipped: {
		projectId: string;
		scheduleId: string;
		at: number;
		reason: string;
		/** The earlier run that still runs, when that is the reason. */
		runId: string | null;
	};
};

export type EngineEventType = keyof EnginePayloads;

export type LoggedEvent = {
	[T in EngineEventType]: {
		seq: number;
		runId: string | null;
		stepId: string | null;
		sessionId: string | null;
		type: T;
		payload: EnginePayloads[T];
		at: number;
	};
}[EngineEventType];

type EventOf<T extends EngineEventType> = Extract<LoggedEvent, { type: T }>;

export async function appendEvent<T extends EngineEventType>(
	db: Database,
	input: {
		type: T;
		payload: EnginePayloads[T];
		runId?: string | null;
		stepId?: string | null;
		sessionId?: string | null;
	},
): Promise<void> {
	await db.insert(event).values({
		runId: input.runId ?? null,
		stepId: input.stepId ?? null,
		sessionId: input.sessionId ?? null,
		type: input.type,
		payload: JSON.stringify(input.payload),
	});
}

export function parseEventRow(row: typeof event.$inferSelect): LoggedEvent {
	const type = row.type as EngineEventType;
	return {
		seq: row.seq,
		runId: row.runId,
		stepId: row.stepId,
		sessionId: row.sessionId,
		type,
		payload: upgradePayload(type, JSON.parse(row.payload)),
		at: row.at.getTime(),
	} as LoggedEvent;
}

type Raw = Record<string, unknown>;

/**
 * Reads payloads written before flow format 2 in today's shape: a scope
 * `{ forEachStepId, itemId }` becomes `{ parentStepId, itemId }`, and the
 * item facts of a GitHub issue (`number`, `body`, `parentNumber`, …) become
 * an element `value`. The log itself is never rewritten.
 */
function upgradePayload(type: EngineEventType, payload: Raw): Raw {
	if (!payload || typeof payload !== "object") return payload;
	if (
		(type === "StepStarted" || type === "RunResumed" || type === "EdgeTaken") &&
		payload.scope
	) {
		return { ...payload, scope: upgradeScope(payload.scope as Raw) };
	}
	if ((type === "ItemStarted" || type === "ItemBlocked") && payload.item) {
		return { ...payload, item: upgradeItemFacts(payload.item as Raw) };
	}
	return payload;
}

function upgradeScope(scope: Raw): Scope {
	if (typeof scope.parentStepId === "string") return scope as Scope;
	return {
		parentStepId: String(scope.forEachStepId),
		itemId: typeof scope.itemId === "string" ? scope.itemId : null,
	};
}

function upgradeItemFacts(item: Raw): ItemFacts {
	if (Object.hasOwn(item, "value")) return item as ItemFacts;
	const value: Record<string, JsonValue> = {};
	const keep = (key: string, from: unknown) => {
		if (from !== null && from !== undefined) value[key] = from as JsonValue;
	};
	keep("id", item.id);
	keep("number", item.number);
	keep("title", item.title);
	keep("body", item.body);
	keep("url", item.url);
	if (item.parentNumber != null || item.parentTitle != null) {
		const parent: Record<string, JsonValue> = {};
		if (item.parentNumber != null) parent.number = item.parentNumber as number;
		if (item.parentTitle != null) parent.title = item.parentTitle as string;
		value.parent = parent;
	}
	return {
		id: String(item.id),
		title: typeof item.title === "string" ? item.title : String(item.id),
		url: typeof item.url === "string" ? item.url : null,
		value,
	};
}

function ofType<T extends EngineEventType>(
	events: readonly LoggedEvent[],
	type: T,
): EventOf<T>[] {
	return events.filter((e): e is EventOf<T> => e.type === type);
}

function bySeq(events: readonly LoggedEvent[]): LoggedEvent[] {
	return [...events].sort((a, b) => a.seq - b.seq);
}

/** The latest `RunStarted`, `RunResumed` or `RunEnded`. */
function latestRunEvent(events: readonly LoggedEvent[]): LoggedEvent | null {
	let latest: LoggedEvent | null = null;
	for (const e of events) {
		if (
			e.type !== "RunStarted" &&
			e.type !== "RunResumed" &&
			e.type !== "RunEnded"
		) {
			continue;
		}
		if (!latest || e.seq > latest.seq) latest = e;
	}
	return latest;
}

/** The seq of the latest `RunStarted` or `RunResumed`: when the current walk began. -1 without one. */
function walkBeganSeq(events: readonly LoggedEvent[]): number {
	let began = -1;
	for (const e of events) {
		if ((e.type === "RunStarted" || e.type === "RunResumed") && e.seq > began) {
			began = e.seq;
		}
	}
	return began;
}

/**
 * The run's status and why it ended. The latest of `RunStarted`,
 * `RunResumed` and `RunEnded` decides: an end gives its status, a start or a
 * resume means the run is `running`, `waiting` while a Gate is open, or
 * `sleeping` while a step waits for a usage limit or the network. A run
 * with none of them (the daemon died while it created the run) is
 * `interrupted`.
 */
export function deriveRunState(events: readonly LoggedEvent[]): {
	status: RunStatus;
	reason: string | null;
} {
	const latest = latestRunEvent(events);
	if (!latest) return { status: "interrupted", reason: null };
	if (latest.type === "RunEnded") {
		return { status: latest.payload.status, reason: latest.payload.reason };
	}
	if (deriveOpenGate(events)) return { status: "waiting", reason: null };
	if (deriveSleep(events)) return { status: "sleeping", reason: null };
	return { status: "running", reason: null };
}

export function deriveRunStatus(events: readonly LoggedEvent[]): RunStatus {
	return deriveRunState(events).status;
}

export type SleepFact = {
	stepId: string;
	reason: WaitReason;
	until: number;
	message: string;
};

/**
 * The wait the run sleeps in: the latest `WaitStarted` of the current walk
 * with no `WaitEnded` after it, on a step that is still open, while the run
 * has not ended.
 */
export function deriveSleep(events: readonly LoggedEvent[]): SleepFact | null {
	const latest = latestRunEvent(events);
	if (!latest || latest.type === "RunEnded") return null;
	const began = latest.seq;
	let wait: EventOf<"WaitStarted"> | null = null;
	for (const e of bySeq(events)) {
		if (e.seq <= began) continue;
		if (e.type === "WaitStarted") wait = e;
		else if (e.type === "WaitEnded" && wait && e.stepId === wait.stepId) {
			wait = null;
		}
	}
	if (!wait?.stepId) return null;
	const stepId = wait.stepId;
	const step = deriveSteps(events).find((s) => s.id === stepId);
	if (!step || step.endedAt !== null) return null;
	return {
		stepId,
		reason: wait.payload.reason,
		until: wait.payload.until,
		message: wait.payload.message,
	};
}

/**
 * The waits of one step's current streak for one reason: those since the
 * step last opened and since its last wait for the other reason.
 */
export function waitStreak(
	events: readonly LoggedEvent[],
	stepId: string,
	reason: WaitReason,
): EnginePayloads["WaitStarted"][] {
	let streak: EnginePayloads["WaitStarted"][] = [];
	for (const e of bySeq(events)) {
		if (e.stepId !== stepId) continue;
		if (e.type === "StepStarted" || e.type === "StepReopened") streak = [];
		else if (e.type === "WaitStarted") {
			if (e.payload.reason === reason) streak.push(e.payload);
			else streak = [];
		}
	}
	return streak;
}

/** A person asked to stop after the running step, since the current walk began. */
export function deriveStopAfterStep(events: readonly LoggedEvent[]): boolean {
	const began = walkBeganSeq(events);
	return events.some(
		(e) => e.type === "StopAfterStepRequested" && e.seq > began,
	);
}

/**
 * The stop time of the run: from `RunStarted`, unless a person resumed the
 * run after it passed.
 */
export function deriveStopAt(events: readonly LoggedEvent[]): number | null {
	let stopAt: number | null = null;
	for (const e of bySeq(events)) {
		if (e.type === "RunStarted") stopAt = e.payload.stopAt ?? null;
		else if (e.type === "RunResumed" && e.payload.clearStopAt) stopAt = null;
	}
	return stopAt;
}

/** The values of the top-level flow's inputs (the params of a run from before flow format 2). */
export function deriveInputs(events: readonly LoggedEvent[]): InputValues {
	const started = events.find((e) => e.type === "RunStarted");
	if (started?.type !== "RunStarted") return {};
	return started.payload.inputs ?? started.payload.params ?? {};
}

/** What started the run: a person unless `RunStarted` names a schedule. */
export function deriveTrigger(events: readonly LoggedEvent[]): RunTrigger {
	const started = events.find((e) => e.type === "RunStarted");
	if (started?.type !== "RunStarted") return { kind: "manual" };
	return started.payload.trigger ?? { kind: "manual" };
}

/** How often the run took each edge of one scope (default: the top level), by edge id. */
export function deriveTraversals(
	events: readonly LoggedEvent[],
	key = "",
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const e of ofType(events, "EdgeTaken")) {
		if (scopeKey(e.payload.scope) !== key) continue;
		counts[e.payload.edgeId] = (counts[e.payload.edgeId] ?? 0) + 1;
	}
	return counts;
}

export type DerivedSession = {
	id: string;
	stepId: string | null;
	prompt: string;
	resumeSessionId: string | null;
	harness: HarnessName;
	harnessSessionId: string | null;
	startedAt: number;
	startSeq: number;
	/** The first end wins: a late duplicate never rewrites history. */
	ending: EnginePayloads["SessionEnded"] | null;
};

/** Sessions in the order they started. */
export function deriveSessions(
	events: readonly LoggedEvent[],
): DerivedSession[] {
	const sessions = new Map<string, DerivedSession>();
	for (const e of bySeq(events)) {
		if (!e.sessionId) continue;
		if (e.type === "SessionStarted") {
			sessions.set(e.sessionId, {
				id: e.sessionId,
				stepId: e.stepId,
				prompt: e.payload.prompt,
				resumeSessionId: e.payload.resumeSessionId,
				harness: e.payload.harness ?? "claude-code",
				harnessSessionId: null,
				startedAt: e.at,
				startSeq: e.seq,
				ending: null,
			});
			continue;
		}
		const session = sessions.get(e.sessionId);
		if (!session) continue;
		if (e.type === "HarnessSessionAssigned") {
			session.harnessSessionId ??= e.payload.harnessSessionId;
		} else if (e.type === "SessionEnded") {
			session.ending ??= e.payload;
		}
	}
	return [...sessions.values()];
}

/** One item of a For Each visit, as the log tells it. */
export type DerivedItem = {
	facts: ItemFacts;
	/** 1-based among the started items; null for an item that was blocked. */
	index: number | null;
	/**
	 * `running` only while the For Each step runs. An item whose For Each
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

export type DerivedStep = {
	id: string;
	nodeId: string;
	nodeType: FlowNodeType;
	visit: number;
	scope: Scope | null;
	transcriptPath: string;
	logPath: string | null;
	startedAt: number;
	startSeq: number;
	/** The seq of the latest `StepStarted` or `StepReopened`. */
	openedSeq: number;
	/** Null while the step runs (also after a reopen). */
	endedAt: number | null;
	outcome: StepOutcome | null;
	outputs: StepOutputs;
	error: string | null;
	sessions: DerivedSession[];
	/** Harness sessions plus what the step spent itself (a decider). */
	costUsd: number;
	/** Gate steps only: the latest `GateOpened` of this step. */
	gate: {
		question: string;
		choices: GateChoice[];
		openedAt: number;
		openedSeq: number;
	} | null;
	/** For Each steps only: its items in the order they started or were blocked. */
	items: DerivedItem[];
	/** Subflow steps only: the call, once its inputs were bound. */
	call: EnginePayloads["FlowCalled"] | null;
};

/**
 * Steps in the order they started. A step's outcome comes from the latest
 * `StepEnded` after its latest opening, so a reopened step is open again
 * until it ends again.
 */
export function deriveSteps(events: readonly LoggedEvent[]): DerivedStep[] {
	const steps = new Map<string, DerivedStep>();
	for (const e of bySeq(events)) {
		if (!e.stepId) continue;
		if (e.type === "StepStarted") {
			steps.set(e.stepId, {
				id: e.stepId,
				nodeId: e.payload.nodeId,
				nodeType: e.payload.nodeType,
				visit: e.payload.visit,
				scope: e.payload.scope ?? null,
				transcriptPath: e.payload.transcriptPath,
				logPath: e.payload.logPath,
				startedAt: e.at,
				startSeq: e.seq,
				openedSeq: e.seq,
				endedAt: null,
				outcome: null,
				outputs: { visit: e.payload.visit },
				error: null,
				sessions: [],
				costUsd: 0,
				gate: null,
				items: [],
				call: null,
			});
			continue;
		}
		const step = steps.get(e.stepId);
		if (!step) continue;
		if (e.type === "GateOpened") {
			step.gate = {
				question: e.payload.question,
				choices: e.payload.choices,
				openedAt: e.at,
				openedSeq: e.seq,
			};
		} else if (e.type === "StepReopened") {
			step.openedSeq = e.seq;
			step.endedAt = null;
			step.outcome = null;
			step.error = null;
		} else if (e.type === "StepEnded" && step.endedAt === null) {
			step.endedAt = e.at;
			step.outcome = e.payload.outcome;
			step.outputs = e.payload.outputs;
			step.error = e.payload.error;
			step.costUsd += e.payload.costUsd ?? 0;
		} else if (e.type === "FlowCalled") {
			step.call = e.payload;
		} else if (e.type === "ItemStarted") {
			step.items.push({
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
			});
		} else if (e.type === "ItemBlocked") {
			step.items.push({
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
			});
		} else if (e.type === "ItemEnded") {
			const item = step.items.findLast(
				(i) => i.facts.id === e.payload.itemId && i.open,
			);
			if (item) {
				item.open = false;
				item.state = e.payload.state;
				item.reason = e.payload.reason;
				item.outputs = e.payload.outputs ?? {};
				item.endedAt = e.at;
			}
		}
	}
	for (const session of deriveSessions(events)) {
		const step = session.stepId ? steps.get(session.stepId) : undefined;
		if (!step) continue;
		step.sessions.push(session);
		step.costUsd += session.ending?.costUsd ?? 0;
	}
	for (const step of steps.values()) {
		if (step.endedAt === null) continue;
		for (const item of step.items) {
			if (!item.open) continue;
			item.state = "failed";
			item.reason = cutShort[step.outcome ?? ""] ?? cutShort.error ?? null;
			item.endedAt = step.endedAt;
		}
	}
	return [...steps.values()];
}

/** Why an item that was still running ended with its For Each step. */
const cutShort: Record<string, string> = {
	stopped: "The run stopped during this item.",
	interrupted: "The daemon stopped during this item.",
	error: "The For Each step failed during this item.",
};

/** The state of each item of a For Each step's visit, by item id. */
export function itemStates(step: DerivedStep): Record<string, ItemState> {
	const states: Record<string, ItemState> = {};
	for (const item of step.items) states[item.facts.id] = item.state;
	return states;
}

/** The template outputs of the latest ended visit of each node of one scope (default: the top level). */
export function deriveNodeOutputs(
	events: readonly LoggedEvent[],
	key = "",
): NodeOutputs {
	const nodes: NodeOutputs = {};
	const nodeOf = new Map<string, string>();
	for (const e of bySeq(events)) {
		if (e.type === "StepStarted" && e.stepId) {
			if (scopeKey(e.payload.scope) === key) {
				nodeOf.set(e.stepId, e.payload.nodeId);
			}
		} else if (e.type === "StepEnded" && e.stepId) {
			const nodeId = nodeOf.get(e.stepId);
			if (nodeId) nodes[nodeId] = { ...e.payload.outputs };
		}
	}
	return nodes;
}

/** How many visits of the node (in one scope, default the top level) the run started so far. */
export function countVisits(
	events: readonly LoggedEvent[],
	nodeId: string,
	key = "",
): number {
	return ofType(events, "StepStarted").filter(
		(e) => e.payload.nodeId === nodeId && scopeKey(e.payload.scope) === key,
	).length;
}

/**
 * Steps started since the walk last began (the run's start or its latest
 * resume), in every scope. `maxStepsPerRun` caps this, so a person can
 * resume a run that hit the cap.
 */
export function countStepsSinceWalkBegan(
	events: readonly LoggedEvent[],
): number {
	const began = walkBeganSeq(events);
	return events.filter((e) => e.type === "StepStarted" && e.seq > began).length;
}

/** The harness session id of the node's latest session (in one scope, default the top level) that has one. */
export function lastHarnessSessionOfNode(
	events: readonly LoggedEvent[],
	nodeId: string,
	key = "",
): string | null {
	const steps = deriveSteps(events).filter(
		(s) => s.nodeId === nodeId && scopeKey(s.scope) === key,
	);
	const sessions = steps.flatMap((s) => s.sessions);
	sessions.sort((a, b) => a.startSeq - b.startSeq);
	return sessions.findLast((s) => s.harnessSessionId)?.harnessSessionId ?? null;
}

/** The run's latest session that has a harness session id. */
export function lastHarnessSession(
	events: readonly LoggedEvent[],
): { harness: HarnessName; harnessSessionId: string } | null {
	const session = deriveSessions(events).findLast((s) => s.harnessSessionId);
	return session?.harnessSessionId
		? { harness: session.harness, harnessSessionId: session.harnessSessionId }
		: null;
}

export type ResumePoint =
	/** Continue this Agent step's harness session. */
	| {
			kind: "session";
			stepId: string;
			nodeId: string;
			harnessSessionId: string;
	  }
	/** Start a new visit of this node. */
	| { kind: "node"; nodeId: string }
	/**
	 * Continue this Subflow or For Each step. A For Each continues the
	 * element `itemId` at `inner` (the called flow's start when null), or,
	 * without an element, its loop with the next element. A Subflow
	 * (`itemId` null) continues its called flow at `inner`.
	 */
	| {
			kind: "call";
			nodeId: string;
			stepId: string;
			itemId: string | null;
			inner: ResumePoint | null;
	  };

/** Outcomes of a calling step that end a visit as the flow means it. */
const callEndings: Partial<Record<FlowNodeType, readonly StepOutcome[]>> = {
	foreach: ["done", "halted"],
	subflow: ["pass", "fail"],
};

const endedAsMeant = (step: DerivedStep): boolean =>
	step.outcome !== null &&
	(callEndings[step.nodeType]?.includes(step.outcome) ?? false);

/**
 * Where `resumeRun` continues. When the run took an edge after its last step
 * started (it stopped or died between steps), the walk continues at that
 * edge's target. Otherwise it continues at the last step's node: an Agent
 * step with a harness session continues that session, a For Each step that
 * did not end with `done` or `halted` continues its loop, any other step
 * runs its node again. Inside a called flow, the point is wrapped in its
 * calling steps, from the inside out: a Subflow that is not over continues
 * its flow there; a For Each element that is still open continues there, an
 * element that ended continues the loop with the next element; a calling
 * step that ended with its own outcome runs again. Null when the run never
 * started a step: it starts over at `start`.
 */
export function deriveResumePoint(
	events: readonly LoggedEvent[],
): ResumePoint | null {
	const steps = deriveSteps(events);
	const last = steps.at(-1);
	const edges = ofType(events, "EdgeTaken");
	const lastEdge = edges.reduce<EventOf<"EdgeTaken"> | null>(
		(latest, e) => (!latest || e.seq > latest.seq ? e : latest),
		null,
	);
	let point: ResumePoint;
	let scope: Scope | null;
	if (lastEdge && (!last || lastEdge.seq > last.startSeq)) {
		point = { kind: "node", nodeId: lastEdge.payload.to };
		scope = lastEdge.payload.scope ?? null;
	} else if (!last) {
		return null;
	} else {
		point = stepResumePoint(last);
		scope = last.scope;
	}
	const byId = new Map(steps.map((s) => [s.id, s]));
	while (scope) {
		const caller = byId.get(scope.parentStepId);
		if (!caller) break;
		if (endedAsMeant(caller)) {
			point = { kind: "node", nodeId: caller.nodeId };
		} else if (caller.nodeType === "subflow") {
			point = {
				kind: "call",
				nodeId: caller.nodeId,
				stepId: caller.id,
				itemId: null,
				inner: point,
			};
		} else {
			const itemId = scope.itemId;
			const item = caller.items.findLast((i) => i.facts.id === itemId);
			point = item?.open
				? {
						kind: "call",
						nodeId: caller.nodeId,
						stepId: caller.id,
						itemId: item.facts.id,
						inner: point,
					}
				: {
						kind: "call",
						nodeId: caller.nodeId,
						stepId: caller.id,
						itemId: null,
						inner: null,
					};
		}
		scope = caller.scope;
	}
	return point;
}

function stepResumePoint(step: DerivedStep): ResumePoint {
	if (step.nodeType === "foreach" && !endedAsMeant(step)) {
		const open = step.items.findLast((i) => i.open);
		return {
			kind: "call",
			nodeId: step.nodeId,
			stepId: step.id,
			itemId: open?.facts.id ?? null,
			inner: null,
		};
	}
	const harnessSessionId =
		step.nodeType === "agent"
			? (step.sessions.findLast((s) => s.harnessSessionId)?.harnessSessionId ??
				null)
			: null;
	if (harnessSessionId) {
		return {
			kind: "session",
			stepId: step.id,
			nodeId: step.nodeId,
			harnessSessionId,
		};
	}
	// A Subflow step that started nothing in its flow yet runs again.
	return { kind: "node", nodeId: step.nodeId };
}

/**
 * The run's cost: what each ended session reported, plus what steps spent
 * outside sessions (a decider).
 */
export function sumCostUsd(events: readonly LoggedEvent[]): number {
	const steps = deriveSteps(events);
	const stepIds = new Set(steps.map((s) => s.id));
	let total = 0;
	for (const step of steps) total += step.costUsd;
	// A session whose step is missing from the log still cost money.
	for (const session of deriveSessions(events)) {
		if (session.stepId && stepIds.has(session.stepId)) continue;
		total += session.ending?.costUsd ?? 0;
	}
	return total;
}

export type OpenGateFact = {
	stepId: string;
	nodeId: string;
	visit: number;
	question: string;
	choices: GateChoice[];
	openedAt: number;
};

/**
 * The Gate the run waits at: a Gate step that opened and has not ended,
 * while the run has not ended. A Gate step that started but never wrote
 * `GateOpened` (the daemon died in between) is not open: recovery
 * interrupts it like any other step.
 */
export function deriveOpenGate(
	events: readonly LoggedEvent[],
): OpenGateFact | null {
	const latest = latestRunEvent(events);
	if (!latest || latest.type === "RunEnded") return null;
	const walkBegan = latest.seq;
	const open = deriveSteps(events).findLast(
		(s) =>
			s.endedAt === null &&
			s.gate !== null &&
			s.gate.openedSeq > s.openedSeq &&
			s.gate.openedSeq > walkBegan,
	);
	if (!open?.gate) return null;
	return {
		stepId: open.id,
		nodeId: open.nodeId,
		visit: open.visit,
		question: open.gate.question,
		choices: open.gate.choices,
		openedAt: open.gate.openedAt,
	};
}

/**
 * The step the run is parked at (an open Gate or a sleeping step) and the
 * calling steps around it, from the inside out. Empty when the run is not
 * parked. These steps stay open while the run waits or sleeps.
 */
export function parkedSteps(events: readonly LoggedEvent[]): DerivedStep[] {
	const stepId = deriveOpenGate(events)?.stepId ?? deriveSleep(events)?.stepId;
	if (!stepId) return [];
	const steps = deriveSteps(events);
	return withEnclosing(steps, stepId);
}

/** The step and the calling steps (Subflow, For Each) it runs in, from the inside out. */
export function withEnclosing(
	steps: readonly DerivedStep[],
	stepId: string,
): DerivedStep[] {
	const byId = new Map(steps.map((s) => [s.id, s]));
	const chain: DerivedStep[] = [];
	for (
		let step = byId.get(stepId);
		step;
		step = step.scope ? byId.get(step.scope.parentStepId) : undefined
	) {
		chain.push(step);
	}
	return chain;
}

/**
 * What a daemon that died left open, per run: sessions and steps that
 * started but never ended, and whether the run itself never ended. An open
 * Gate or a sleeping step is not lost work: it waits for a person or a
 * timer, so it stays open (with the calling steps around it) and its run
 * stays `waiting` or `sleeping`.
 */
export function openWork(events: readonly LoggedEvent[]): {
	sessions: DerivedSession[];
	steps: DerivedStep[];
	runOpen: boolean;
} {
	const parked = new Set(parkedSteps(events).map((s) => s.id));
	return {
		sessions: deriveSessions(events).filter((s) => s.ending === null),
		steps: deriveSteps(events).filter(
			(s) => s.endedAt === null && !parked.has(s.id),
		),
		runOpen: deriveRunStatus(events) === "running",
	};
}

/** Groups events by run id. Events without a run are dropped. */
export function groupByRun(
	events: readonly LoggedEvent[],
): Map<string, LoggedEvent[]> {
	const grouped = new Map<string, LoggedEvent[]>();
	for (const e of events) {
		if (!e.runId) continue;
		const list = grouped.get(e.runId) ?? [];
		list.push(e);
		grouped.set(e.runId, list);
	}
	return grouped;
}
