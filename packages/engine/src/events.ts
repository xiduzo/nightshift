import type { AgentErrorKind, AgentUsage } from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema/nightshift";
import type {
	FlowNodeType,
	ItemState,
	NodeOutputs,
	Outcome,
} from "@nightshift/flows";

import type { RunStatus, SessionSummary, StepOutcome } from "./types";

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

export type StepOutputs = Record<string, string | number>;

export type GateChoice = { name: string; description?: string };

/**
 * Where a step runs: null at the top level of the run's flow, or inside the
 * body of a For Each step for one item. Step ids are unique, so the innermost
 * For Each step and the item are enough: a nested For Each step has a scope
 * of its own, and the chain of scopes leads up to the top level.
 */
export type Scope = { forEachStepId: string; itemId: string };

/** The key that separates node ids, visits, outputs and edge counts per scope. */
export function scopeKey(scope: Scope | null | undefined): string {
	return scope ? `${scope.forEachStepId}/${scope.itemId}` : "";
}

/** What the engine keeps of a source item when it starts or blocks it. */
export type ItemFacts = {
	id: string;
	number: number | null;
	title: string;
	body: string | null;
	url: string | null;
	parentNumber: number | null;
	parentTitle: string | null;
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
		/** The run parameters, defaults applied. Absent on older runs. */
		params?: Record<string, string>;
	};
	WorktreeCreated: { worktreePath: string; branch: string; baseRef: string };
	/** A person continued a stopped, failed or interrupted run. */
	RunResumed: {
		/** The node the walk continues at. */
		nodeId: string;
		/** Set when the walk continues an existing Agent step's session. */
		stepId: string | null;
		prompt: string | null;
		/** The scope of `nodeId`: the For Each item the walk continues in. */
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
	 * harness session, a For Each step to continue its items.
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
	/** A For Each step read its source. */
	ItemsRead: { count: number; open: number };
	/** A For Each step starts an item: its body runs in the scope of this item. */
	ItemStarted: {
		item: ItemFacts;
		/** 1 for the first item the visit started. */
		index: number;
		/** Null without a branch per item. */
		branch: string | null;
		baseBranch: string | null;
	};
	/** An item that never starts: a blocker of it failed or is blocked. */
	ItemBlocked: { item: ItemFacts; blocker: string; reason: string };
	ItemEnded: {
		itemId: string;
		state: Exclude<ItemState, "running" | "blocked">;
		reason: string | null;
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
	return {
		seq: row.seq,
		runId: row.runId,
		stepId: row.stepId,
		sessionId: row.sessionId,
		type: row.type as EngineEventType,
		payload: JSON.parse(row.payload),
		at: row.at.getTime(),
	} as LoggedEvent;
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

export function deriveParams(
	events: readonly LoggedEvent[],
): Record<string, string> {
	const started = events.find((e) => e.type === "RunStarted");
	return started?.type === "RunStarted" ? (started.payload.params ?? {}) : {};
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
		} else if (e.type === "ItemStarted") {
			step.items.push({
				facts: e.payload.item,
				index: e.payload.index,
				state: "running",
				open: true,
				branch: e.payload.branch,
				baseBranch: e.payload.baseBranch,
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

/** The harness session id of the run's latest session that has one. */
export function lastHarnessSession(
	events: readonly LoggedEvent[],
): string | null {
	return (
		deriveSessions(events).findLast((s) => s.harnessSessionId)
			?.harnessSessionId ?? null
	);
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
	 * Continue this For Each step: the item `itemId` at `inner` (its body's
	 * start when null), or, without an item, the loop with its next item.
	 */
	| {
			kind: "foreach";
			nodeId: string;
			stepId: string;
			itemId: string | null;
			inner: ResumePoint | null;
	  };

/** For Each outcomes that end a visit as the flow means it. */
const forEachEndings: readonly (StepOutcome | null)[] = ["done", "halted"];

/**
 * Where `resumeRun` continues. When the run took an edge after its last step
 * started (it stopped or died between steps), the walk continues at that
 * edge's target. Otherwise it continues at the last step's node: an Agent
 * step with a harness session continues that session, a For Each step that
 * did not end with `done` or `halted` continues its loop, any other step
 * runs its node again. Inside a For Each body, the point is wrapped in its
 * For Each steps, from the inside out: an item that is still open continues
 * there, an item that ended continues the loop with the next item, and a
 * For Each that ended with its outcome runs again. Null when the run never
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
		const forEach = byId.get(scope.forEachStepId);
		if (!forEach) break;
		const item = forEach.items.findLast((i) => i.facts.id === scope?.itemId);
		if (forEachEndings.includes(forEach.outcome)) {
			point = { kind: "node", nodeId: forEach.nodeId };
		} else if (!item?.open) {
			point = {
				kind: "foreach",
				nodeId: forEach.nodeId,
				stepId: forEach.id,
				itemId: null,
				inner: null,
			};
		} else {
			point = {
				kind: "foreach",
				nodeId: forEach.nodeId,
				stepId: forEach.id,
				itemId: item.facts.id,
				inner: point,
			};
		}
		scope = forEach.scope;
	}
	return point;
}

function stepResumePoint(step: DerivedStep): ResumePoint {
	if (step.nodeType === "foreach" && !forEachEndings.includes(step.outcome)) {
		const open = step.items.findLast((i) => i.open);
		return {
			kind: "foreach",
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
 * For Each steps around it, from the inside out. Empty when the run is not
 * parked. These steps stay open while the run waits or sleeps.
 */
export function parkedSteps(events: readonly LoggedEvent[]): DerivedStep[] {
	const stepId = deriveOpenGate(events)?.stepId ?? deriveSleep(events)?.stepId;
	if (!stepId) return [];
	const steps = deriveSteps(events);
	return withEnclosing(steps, stepId);
}

/** The step and the For Each steps whose bodies it runs in, from the inside out. */
export function withEnclosing(
	steps: readonly DerivedStep[],
	stepId: string,
): DerivedStep[] {
	const byId = new Map(steps.map((s) => [s.id, s]));
	const chain: DerivedStep[] = [];
	for (
		let step = byId.get(stepId);
		step;
		step = step.scope ? byId.get(step.scope.forEachStepId) : undefined
	) {
		chain.push(step);
	}
	return chain;
}

/**
 * What a daemon that died left open, per run: sessions and steps that
 * started but never ended, and whether the run itself never ended. An open
 * Gate or a sleeping step is not lost work: it waits for a person or a
 * timer, so it stays open (with the For Each steps around it) and its run
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
