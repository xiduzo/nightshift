import type { AgentErrorKind, AgentUsage } from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema/nightshift";
import type { FlowNodeType, NodeOutputs, Outcome } from "@nightshift/flows";

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
	};
	WorktreeCreated: { worktreePath: string; branch: string; baseRef: string };
	/** A person continued a stopped, failed or interrupted run. */
	RunResumed: {
		/** The node the walk continues at. */
		nodeId: string;
		/** Set when the walk continues an existing Agent step's session. */
		stepId: string | null;
		prompt: string | null;
	};
	/** A new visit of a node. */
	StepStarted: {
		nodeId: string;
		nodeType: FlowNodeType;
		visit: number;
		transcriptPath: string;
		/** Command steps only. */
		logPath: string | null;
	};
	/** An ended Agent step runs again in a new session of the same harness session. */
	StepReopened: { prompt: string };
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
	EdgeTaken: { edgeId: string; from: string; to: string; outcome: Outcome };
	StopRequested: Record<string, never>;
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

/**
 * The run's status and why it ended. The latest of `RunStarted`,
 * `RunResumed` and `RunEnded` decides: an end gives its status, a start or a
 * resume means the run is `running`, or `waiting` while a Gate is open. A run
 * with none of them (the daemon died while it created the run) is
 * `interrupted`.
 */
export function deriveRunState(events: readonly LoggedEvent[]): {
	status: RunStatus;
	reason: string | null;
} {
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
	if (!latest) return { status: "interrupted", reason: null };
	if (latest.type === "RunEnded") {
		return { status: latest.payload.status, reason: latest.payload.reason };
	}
	if (deriveOpenGate(events)) return { status: "waiting", reason: null };
	return { status: "running", reason: null };
}

export function deriveRunStatus(events: readonly LoggedEvent[]): RunStatus {
	return deriveRunState(events).status;
}

/** How often the run took each edge, by edge id. */
export function deriveTraversals(
	events: readonly LoggedEvent[],
): Record<string, number> {
	const counts: Record<string, number> = {};
	for (const e of ofType(events, "EdgeTaken")) {
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

export type DerivedStep = {
	id: string;
	nodeId: string;
	nodeType: FlowNodeType;
	visit: number;
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
		}
	}
	for (const session of deriveSessions(events)) {
		const step = session.stepId ? steps.get(session.stepId) : undefined;
		if (!step) continue;
		step.sessions.push(session);
		step.costUsd += session.ending?.costUsd ?? 0;
	}
	return [...steps.values()];
}

/** The template outputs of the latest ended visit of each node. */
export function deriveNodeOutputs(events: readonly LoggedEvent[]): NodeOutputs {
	const nodes: NodeOutputs = {};
	const nodeOf = new Map<string, string>();
	for (const e of bySeq(events)) {
		if (e.type === "StepStarted" && e.stepId) {
			nodeOf.set(e.stepId, e.payload.nodeId);
		} else if (e.type === "StepEnded" && e.stepId) {
			const nodeId = nodeOf.get(e.stepId);
			if (nodeId) nodes[nodeId] = { ...e.payload.outputs };
		}
	}
	return nodes;
}

/** How many visits of the node the run started so far. */
export function countVisits(
	events: readonly LoggedEvent[],
	nodeId: string,
): number {
	return ofType(events, "StepStarted").filter(
		(e) => e.payload.nodeId === nodeId,
	).length;
}

/**
 * Steps started since the walk last began (the run's start or its latest
 * resume). `maxStepsPerRun` caps this, so a person can resume a run that hit
 * the cap.
 */
export function countStepsSinceWalkBegan(
	events: readonly LoggedEvent[],
): number {
	let began = -1;
	for (const e of events) {
		if ((e.type === "RunStarted" || e.type === "RunResumed") && e.seq > began) {
			began = e.seq;
		}
	}
	return events.filter((e) => e.type === "StepStarted" && e.seq > began).length;
}

/** The harness session id of the node's latest session that has one. */
export function lastHarnessSessionOfNode(
	events: readonly LoggedEvent[],
	nodeId: string,
): string | null {
	const steps = deriveSteps(events).filter((s) => s.nodeId === nodeId);
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
	| { kind: "node"; nodeId: string };

/**
 * Where `resumeRun` continues. When the run took an edge after its last step
 * started (it stopped or died between steps), the walk continues at that
 * edge's target. Otherwise it continues at the last step's node: an Agent
 * step with a harness session continues that session, any other step runs
 * its node again. Null when the run never started a step: it starts over at
 * `start`.
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
	if (lastEdge && (!last || lastEdge.seq > last.startSeq)) {
		return { kind: "node", nodeId: lastEdge.payload.to };
	}
	if (!last) return null;
	const harnessSessionId =
		last.nodeType === "agent"
			? (last.sessions.findLast((s) => s.harnessSessionId)?.harnessSessionId ??
				null)
			: null;
	if (harnessSessionId) {
		return {
			kind: "session",
			stepId: last.id,
			nodeId: last.nodeId,
			harnessSessionId,
		};
	}
	return { kind: "node", nodeId: last.nodeId };
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
	let lastRunEvent: LoggedEvent | null = null;
	for (const e of events) {
		if (
			(e.type === "RunStarted" ||
				e.type === "RunResumed" ||
				e.type === "RunEnded") &&
			(!lastRunEvent || e.seq > lastRunEvent.seq)
		) {
			lastRunEvent = e;
		}
	}
	if (!lastRunEvent || lastRunEvent.type === "RunEnded") return null;
	const walkBegan = lastRunEvent.seq;
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
 * What a daemon that died left open, per run: sessions and steps that
 * started but never ended, and whether the run itself never ended. An open
 * Gate is not lost work: it waits for a person, so it stays open and its
 * run stays `waiting`.
 */
export function openWork(events: readonly LoggedEvent[]): {
	sessions: DerivedSession[];
	steps: DerivedStep[];
	runOpen: boolean;
} {
	const gate = deriveOpenGate(events);
	return {
		sessions: deriveSessions(events).filter((s) => s.ending === null),
		steps: deriveSteps(events).filter(
			(s) => s.endedAt === null && s.id !== gate?.stepId,
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
