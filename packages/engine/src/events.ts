import type { CostSource } from "@nightshift/agents/pricing";
import type {
	AgentErrorKind,
	AgentHarnessName,
	AgentUsage,
} from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import { event, project, run } from "@nightshift/db/schema/nightshift";
import type {
	FlowNodeType,
	ItemState,
	JsonValue,
	NodeOutputs,
	Outcome,
	OutcomeColor,
	WaitUntil,
} from "@nightshift/flows";
import { sql } from "drizzle-orm";

import type {
	RunResume,
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

/** One choice of a Gate: an option of its Decision node, with the colour the node gives it. */
export type GateChoice = {
	name: string;
	description?: string;
	color?: OutcomeColor;
};

/**
 * Where a step runs: null at the top level of the run's flow, or inside a
 * flow that a Call step called. `parentStepId` is that step; `itemId` is
 * the element of a Call with `each` (null for a Call once). Step ids are
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

/** Why the run policy waits: a usage limit, or the network. */
export type PolicyWaitReason = "usage-limit" | "network";
/**
 * Why a step waits: the run policy, or what a Wait node waits for (a
 * duration, a time, a command that passes, a signal).
 */
export type WaitReason =
	| PolicyWaitReason
	| WaitUntil["kind"]
	/** The step's Device is offline: it starts when the Device is back. */
	| "device-offline";

/** Who resumed a run: a person, or the daemon after a restart. */
export type ResumedBy = RunResume["by"];
/** What a `RunResumed` did beyond a resume (`RunResumed.action`). */
export type ResumeAction = Exclude<RunResume["action"], "resume">;

export type EnginePayloads = {
	ProjectAdded: {
		projectId: string;
		name: string;
		repoPath: string;
		/** The normalised `origin`, null without one. Absent before Clones. */
		remote?: string | null;
	};
	ProjectRemoved: { projectId: string };
	/** `addProject` on the path of a removed project. */
	ProjectRestored: { projectId: string };
	/**
	 * A folder became a Project's Clone on a Device: a folder whose `origin`
	 * names a Project already known, or a Clone that moved to a new folder.
	 */
	CloneAdded: { projectId: string; deviceId: string; path: string };
	/**
	 * On a Host: a Device paired with it. `ownerId` is the Person who
	 * approved the pairing; `home`: this Host keeps the Device's document.
	 * In the owner's personal Space.
	 */
	DeviceJoined: {
		deviceId: string;
		name: string;
		platform: string;
		ownerId: string;
		home: boolean;
	};
	/** On a Host: the owner removed the Device's access. Its key is gone. */
	DeviceRevoked: { deviceId: string };
	/** On a Host: the Device's link answered after a silence. */
	DeviceOnline: { deviceId: string };
	/** On a Host: the Device's link went silent, or its access was removed. */
	DeviceOffline: { deviceId: string };
	/**
	 * A Person became a Member of the Space with a role: they accepted an
	 * invitation (`invitedBy` sent it), made the Space, or were added. `by`
	 * is who did it; null when nobody signed in did.
	 */
	MemberJoined: {
		personId: string;
		role: string;
		by: string | null;
		invitedBy?: string;
	};
	/** A Person is no longer a Member of the Space. `by` removed them. */
	MemberRemoved: { personId: string; by: string | null };
	/** A Member got another role. `by` changed it. */
	MemberRoleChanged: {
		personId: string;
		role: string;
		previousRole: string;
		by: string | null;
	};
	/**
	 * A Device's owner offered one of its Agent Profiles to the Space, or
	 * changed the caps of that Offer. `by` made it.
	 */
	OfferMade: {
		deviceId: string;
		deviceName: string;
		profile: string;
		permissionCap: string;
		sessionCap: number;
		by: string | null;
	};
	/** The Offer ended: its Device's owner withdrew it. Running steps under it end as stopped. */
	OfferWithdrawn: { deviceId: string; profile: string; by: string | null };
	/** A person gave the project a new name. */
	ProjectRenamed: { projectId: string; name: string };
	/** A person moved the project, with its Clones, runs and events, to another Space. */
	ProjectMoved: { projectId: string; from: string; to: string };
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
		/**
		 * The Person who started the run (their id). Null for a schedule.
		 * Absent before Members.
		 */
		startedBy?: string | null;
	};
	WorktreeCreated: { worktreePath: string; branch: string; baseRef: string };
	/**
	 * The run's work moved to another Device before a step there: the
	 * Device that had it pushed the branch (it had nothing uncommitted), and
	 * the next one fetched it into its own worktree of the run.
	 * `worktreePath` is that worktree, on `to`.
	 */
	HandedOff: {
		from: string;
		to: string;
		commit: string;
		branch: string;
		worktreePath: string;
	};
	/**
	 * Another Device walks the run from here on: the one that walked it
	 * wrote this last; the new Walker resumes from the archived checkpoint.
	 */
	WalkerMoved: { from: string; to: string; by: string | null };
	/**
	 * A person continued a stopped, failed or interrupted run, or the daemon
	 * continued a run it had stopped mid-step, after a restart.
	 */
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
		/** Absent before automatic resume: a person. */
		by?: ResumedBy;
		/** Why the daemon resumed the run. */
		reason?: string;
		/**
		 * What the person asked for, when it was more than a resume.
		 * `restart`: the running step was stopped and continued at once
		 * (`restartStep`). `rerun`: the run walks again from `nodeId`, a
		 * top-level node, with a new visit of it (`rerunFrom`); `stepId` is
		 * then the Agent step whose harness session that visit continues
		 * with `prompt`, or null for a fresh session. Absent: a resume.
		 */
		action?: ResumeAction;
	};
	/** A new visit of a node. */
	StepStarted: {
		nodeId: string;
		nodeType: FlowNodeType;
		visit: number;
		transcriptPath: string;
		/** Command steps, and Call steps with a command source, only. */
		logPath: string | null;
		/** Null (or absent before Slice 4) at the top level. */
		scope?: Scope | null;
		/** The Device the step runs on. Absent before Devices: this computer. */
		deviceId?: string;
	} & StepBudget;
	/**
	 * An ended step runs again: an Agent step in a new session of the same
	 * harness session, a Call step to continue its called flow.
	 */
	StepReopened: { prompt: string | null } & StepBudget;
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
		/**
		 * Where `costUsd` came from. Null: the decider answered, but its cost
		 * is not known. Absent in older logs, and when nothing was asked.
		 */
		costSource?: CostSource | null;
		/**
		 * The variables the step's writes (`set`) changed, by name. Absent
		 * when it wrote none. In `StepEnded`, so a step never ends without
		 * its writes, or the reverse.
		 */
		variables?: Record<string, JsonValue>;
	};
	/**
	 * The variables of a flow when it starts (each `initial`), in the scope
	 * the flow runs in: null at the top level of the run.
	 */
	VariablesSet: {
		values: Record<string, JsonValue>;
		scope: Scope | null;
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
		harness?: AgentHarnessName;
	};
	HarnessSessionAssigned: { harnessSessionId: string; model: string | null };
	/**
	 * What a session has spent so far: a running total, logged while it
	 * runs, at most every few seconds. Only harnesses that report usage
	 * while they work have it. `SessionEnded` has the final cost; without
	 * one (the session failed, or Night Shift stopped), the last total counts.
	 */
	SessionUsage: {
		usage: AgentUsage;
		costUsd: number | null;
		costSource?: CostSource | null;
	};
	SessionEnded: {
		outcome: SessionOutcome;
		error: string | null;
		errorKind: AgentErrorKind | null;
		usage: AgentUsage | null;
		costUsd: number | null;
		/** Where `costUsd` came from. Absent in older logs: reported, when set. */
		costSource?: CostSource | null;
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
	 * A Call step (once) calls its flow with these input values (bindings
	 * rendered, defaults applied). The called flow runs in the step's scope.
	 */
	FlowCalled: { flow: string; inputs: InputValues };
	/** A Call step with `each` read its source. */
	ItemsRead: { count: number; open: number };
	/** A Call step with `each` starts an element: its flow runs in the scope of this element. */
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
	 * A step waits for a usage limit to reset or for the network, or a Wait
	 * node waits for what it was told to. The step stays open and the run
	 * sleeps. A fact, not a timer: a new daemon rebuilds the timer from it.
	 */
	WaitStarted: {
		reason: WaitReason;
		/** Epoch ms when the step continues. Null for a wait with no time: a signal with no timeout. */
		until: number | null;
		message: string;
		/** Epoch ms of the first wait of this streak (the network grace counts from it). */
		since: number;
		/** A Wait node on a signal: the signal's name. */
		signal?: string;
		/** The Device the step waits for or on: a usage limit is its harness login's. */
		deviceId?: string;
	};
	/** The wait is over: the step continues. `early` when a person resumed the run; `signal` when one arrived. */
	WaitEnded: { early: boolean; signal?: string };
	StopRequested: Record<string, never>;
	/** A person asked to stop the run before its next step or item. */
	StopAfterStepRequested: Record<string, never>;
	/** A person withdrew the stop after the step: the run goes on. */
	StopAfterStepCancelled: Record<string, never>;
	RunEnded: { status: RunEnding; reason: string | null };
	/**
	 * Something went wrong that did not fail the step, and that a person
	 * should know: for example, what a step cost is not known. Logged with
	 * the step it is about, when there is one.
	 */
	RunWarned: { kind: RunWarningKind; message: string };
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

/**
 * A step's time budget, on `StepStarted` and `StepReopened`, so it outlives
 * the timers of the process that runs the step (`deriveStepClocks`). Each
 * field is set only when the step has that limit, and absent in logs from
 * before it: such a step has only its timers.
 */
export type StepBudget = {
	/** How long the step may run (its node's `timeoutMinutes`), in ms. */
	timeoutMs?: number;
	/** How long the step may go without activity (`idleMinutes`), in ms. */
	idleMs?: number;
};

export type EngineEventType = keyof EnginePayloads;

/** What a run warning is about. `cost-unknown`: a step ended without a cost. */
export type RunWarningKind = "cost-unknown";

/**
 * What something cost, as far as it is known: the reported and estimated
 * dollars, whether part of them is an estimate, how many sessions or model
 * calls ended without a cost (their spend is not in `usd`), and how many
 * ended or spent so far. With no calls, nothing could cost.
 */
export type CostTally = {
	usd: number;
	estimated: boolean;
	missing: number;
	calls: number;
};

export const NO_COST: CostTally = {
	usd: 0,
	estimated: false,
	missing: 0,
	calls: 0,
};

export function addCost(a: CostTally, b: CostTally): CostTally {
	return {
		usd: a.usd + b.usd,
		estimated: a.estimated || b.estimated,
		missing: a.missing + b.missing,
		calls: a.calls + b.calls,
	};
}

/**
 * A session's cost: its final cost, else what it spent so far (it still
 * runs, failed, or Night Shift stopped during it). A finished session
 * without either is missing: it did work. A session that failed without
 * usage spent what nobody knows, usually nothing, so it does not count.
 */
export function sessionCost(
	session: Pick<DerivedSession, "ending" | "spent">,
): CostTally {
	const { ending, spent } = session;
	const known =
		ending?.costUsd != null ? ending : spent?.costUsd != null ? spent : null;
	if (known?.costUsd != null) {
		return {
			usd: known.costUsd,
			estimated: known.costSource === "estimated",
			missing: 0,
			calls: 1,
		};
	}
	if (!ending) return NO_COST;
	return {
		...NO_COST,
		missing: ending.outcome === "finished" ? 1 : 0,
		calls: 1,
	};
}

/** What a step spent outside sessions (a decider), from its `StepEnded`. */
export function stepEndCost(payload: EnginePayloads["StepEnded"]): CostTally {
	if (payload.costUsd == null) {
		// Absent: nothing was asked. Null: the decider answered without a cost.
		return payload.costSource === null
			? { ...NO_COST, missing: 1, calls: 1 }
			: NO_COST;
	}
	return {
		usd: payload.costUsd,
		estimated: payload.costSource === "estimated",
		missing: 0,
		calls: 1,
	};
}

/** One warning of a run, in the order they were logged. */
export type DerivedWarning = {
	stepId: string | null;
	kind: RunWarningKind;
	message: string;
	at: number;
};

export function deriveWarnings(
	events: readonly LoggedEvent[],
): DerivedWarning[] {
	return ofType(bySeq(events), "RunWarned").map((e) => ({
		stepId: e.stepId,
		kind: e.payload.kind,
		message: e.payload.message,
		at: e.at,
	}));
}

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

export type EventInput<T extends EngineEventType> = {
	type: T;
	payload: EnginePayloads[T];
	runId?: string | null;
	stepId?: string | null;
	sessionId?: string | null;
	/** The Space of a fact of no run and no project (a Device's). */
	spaceId?: string;
};

/**
 * Appends one event as `walkerId`'s next and returns it as committed, with
 * its seq and time. The Walker's count (`walker_seq`) is taken in the same
 * statement, so two appends cannot get one number. The event's Space is
 * its run's, or for a fact of no run its project's (`payload.projectId`),
 * read in the same statement too. The engine appends through its run log
 * (`run-log.ts`), never here directly.
 */
export async function appendEvent<T extends EngineEventType>(
	db: Database,
	input: EventInput<T>,
	walkerId: string,
): Promise<LoggedEvent> {
	const [row] = await db
		.insert(event)
		.values({
			runId: input.runId ?? null,
			stepId: input.stepId ?? null,
			sessionId: input.sessionId ?? null,
			type: input.type,
			payload: JSON.stringify(input.payload),
			spaceId: spaceOf(input),
			walkerId,
			walkerSeq: sql`(select coalesce(max(${event.walkerSeq}), 0) + 1 from ${event} where ${event.walkerId} = ${walkerId})`,
		})
		.returning();
	if (!row) throw new Error(`Could not append ${input.type}.`);
	return parseEventRow(row);
}

/** The Space of an event: its run's, else its project's, else the one it names. */
function spaceOf(input: EventInput<EngineEventType>) {
	if (input.runId) {
		return sql`(select ${run.spaceId} from ${run} where ${run.id} = ${input.runId})`;
	}
	if (input.spaceId) return input.spaceId;
	const projectId = (input.payload as { projectId?: unknown }).projectId;
	if (typeof projectId !== "string") {
		throw new Error(
			`${input.type} names no run, no project and no Space: its Space is unknown.`,
		);
	}
	return sql`(select ${project.spaceId} from ${project} where ${project.id} = ${projectId})`;
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

/** When the run ended: the time of its `RunEnded`, or null while it is open again or never ended. */
export function deriveEndedAt(events: readonly LoggedEvent[]): number | null {
	const latest = latestRunEvent(events);
	return latest?.type === "RunEnded" ? latest.at : null;
}

export type SleepFact = {
	stepId: string;
	reason: WaitReason;
	/** When the step continues; null while it waits for a signal with no timeout. */
	until: number | null;
	message: string;
	/** The signal the step waits for, else null. */
	signal: string | null;
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
		signal: wait.payload.signal ?? null,
	};
}

/**
 * Where a run's work is: the Device that has it now (the run's Device,
 * then the `to` of each `HandedOff`), and the run's worktree on each
 * Device it reached.
 */
export function deriveWorktrees(
	events: readonly LoggedEvent[],
	run: { deviceId: string | null; walkerId: string; worktreePath: string },
): { holder: string; paths: Map<string, string> } {
	let holder = run.deviceId ?? run.walkerId;
	const paths = new Map([[holder, run.worktreePath]]);
	for (const e of bySeq(events)) {
		if (e.type !== "HandedOff") continue;
		holder = e.payload.to;
		paths.set(holder, e.payload.worktreePath);
	}
	return { holder, paths };
}

/** A person asked to stop after the running step, since the current walk began. */
export function deriveStopAfterStep(events: readonly LoggedEvent[]): boolean {
	const began = walkBeganSeq(events);
	let requested = false;
	for (const e of bySeq(events)) {
		if (e.seq <= began) continue;
		if (e.type === "StopAfterStepRequested") requested = true;
		else if (e.type === "StopAfterStepCancelled") requested = false;
	}
	return requested;
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

/**
 * How often the daemon resumed the run on its own since it started or a
 * person last resumed it.
 */
export function countDaemonResumes(events: readonly LoggedEvent[]): number {
	let count = 0;
	for (const e of bySeq(events)) {
		if (e.type === "RunStarted") count = 0;
		else if (e.type === "RunResumed") {
			count = e.payload.by === "daemon" ? count + 1 : 0;
		}
	}
	return count;
}

/** Every resume of the run, oldest first. */
export function deriveResumes(events: readonly LoggedEvent[]): RunResume[] {
	return ofType(bySeq(events), "RunResumed").map((e) => ({
		at: e.at,
		by: e.payload.by ?? "person",
		nodeId: e.payload.nodeId,
		reason: e.payload.reason ?? null,
		action: e.payload.action ?? "resume",
	}));
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
	harness: AgentHarnessName;
	harnessSessionId: string | null;
	startedAt: number;
	startSeq: number;
	/** The first end wins: a late duplicate never rewrites history. */
	ending: EnginePayloads["SessionEnded"] | null;
	/** The last running total (`SessionUsage`), or null. */
	spent: EnginePayloads["SessionUsage"] | null;
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
				spent: null,
			});
			continue;
		}
		const session = sessions.get(e.sessionId);
		if (!session) continue;
		if (e.type === "HarnessSessionAssigned") {
			session.harnessSessionId ??= e.payload.harnessSessionId;
		} else if (e.type === "SessionUsage") {
			session.spent = e.payload;
		} else if (e.type === "SessionEnded") {
			session.ending ??= e.payload;
		}
	}
	return [...sessions.values()];
}

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
	cost: CostTally;
	/** Gate steps only: the latest `GateOpened` of this step. */
	gate: {
		question: string;
		choices: GateChoice[];
		openedAt: number;
		openedSeq: number;
	} | null;
	/** Call steps with `each` only: its items in the order they started or were blocked. */
	items: DerivedItem[];
	/** Call steps (once) only: the call, once its inputs were bound. */
	call: EnginePayloads["FlowCalled"] | null;
};

/**
 * The node types of runs from before flow version 4, read as today's: a
 * Subflow step and a For Each step are Call steps. The one place the read
 * model maps them, so old runs render like new ones.
 */
const legacyNodeTypes: Readonly<Record<string, FlowNodeType>> = {
	subflow: "call",
	foreach: "call",
};

/** A logged node type as today's `FlowNodeType`. */
export function nodeTypeOf(logged: string): FlowNodeType {
	return legacyNodeTypes[logged] ?? (logged as FlowNodeType);
}

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
				nodeType: nodeTypeOf(e.payload.nodeType),
				visit: e.payload.visit,
				scope: e.payload.scope ?? null,
				transcriptPath: e.payload.transcriptPath,
				logPath: e.payload.logPath,
				deviceId: e.payload.deviceId ?? null,
				startedAt: e.at,
				startSeq: e.seq,
				openedSeq: e.seq,
				endedAt: null,
				outcome: null,
				outputs: { visit: e.payload.visit },
				error: null,
				sessions: [],
				cost: NO_COST,
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
			step.cost = addCost(step.cost, stepEndCost(e.payload));
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
		step.cost = addCost(step.cost, sessionCost(session));
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

/** Why an item that was still running ended with its Call step. */
const cutShort: Record<string, string> = {
	stopped: "The run stopped during this item.",
	interrupted: "Night Shift stopped during this item.",
	error: "The step failed during this item.",
};

/** The state of each item of a Call step's visit, by item id. */
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

/**
 * The variables of one scope (default: the top level) as the log has them:
 * the values the flow started with, then each step's writes in order.
 */
export function deriveVariables(
	events: readonly LoggedEvent[],
	key = "",
): Record<string, JsonValue> {
	let values: Record<string, JsonValue> = {};
	const inScope = new Set<string>();
	for (const e of bySeq(events)) {
		if (e.type === "VariablesSet") {
			if (scopeKey(e.payload.scope) === key) {
				values = { ...values, ...e.payload.values };
			}
		} else if (e.type === "StepStarted" && e.stepId) {
			if (scopeKey(e.payload.scope) === key) inScope.add(e.stepId);
		} else if (
			e.type === "StepEnded" &&
			e.stepId &&
			inScope.has(e.stepId) &&
			e.payload.variables
		) {
			values = { ...values, ...e.payload.variables };
		}
	}
	return values;
}

/** One value a variable took in a run, from the log. */
export type VariableChange = {
	/** The flow invocation the variable belongs to: null for the run's top-level flow. */
	scope: Scope | null;
	name: string;
	value: JsonValue;
	/** The step whose write set it; null for the value the flow started with. */
	stepId: string | null;
	at: number;
};

/**
 * Every value each variable took, in every scope, oldest first: the values
 * each flow started with (`VariablesSet`), then each step's writes.
 */
export function deriveVariableChanges(
	events: readonly LoggedEvent[],
): VariableChange[] {
	const changes: VariableChange[] = [];
	const scopeOfStep = new Map<string, Scope | null>();
	for (const e of bySeq(events)) {
		if (e.type === "VariablesSet") {
			for (const [name, value] of Object.entries(e.payload.values)) {
				changes.push({
					scope: e.payload.scope ?? null,
					name,
					value,
					stepId: null,
					at: e.at,
				});
			}
		} else if (e.type === "StepStarted" && e.stepId) {
			scopeOfStep.set(e.stepId, e.payload.scope ?? null);
		} else if (e.type === "StepEnded" && e.stepId && e.payload.variables) {
			for (const [name, value] of Object.entries(e.payload.variables)) {
				changes.push({
					scope: scopeOfStep.get(e.stepId) ?? null,
					name,
					value,
					stepId: e.stepId,
					at: e.at,
				});
			}
		}
	}
	return changes;
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
): { harness: AgentHarnessName; harnessSessionId: string } | null {
	const session = deriveSessions(events).findLast((s) => s.harnessSessionId);
	return session?.harnessSessionId
		? { harness: session.harness, harnessSessionId: session.harnessSessionId }
		: null;
}

/**
 * The run's cost: what each ended session reported, plus what steps spent
 * outside sessions (a decider).
 */
export function sumCost(events: readonly LoggedEvent[]): CostTally {
	const steps = deriveSteps(events);
	const stepIds = new Set(steps.map((s) => s.id));
	let total = NO_COST;
	for (const step of steps) total = addCost(total, step.cost);
	// A session whose step is missing from the log still cost money.
	for (const session of deriveSessions(events)) {
		if (session.stepId && stepIds.has(session.stepId)) continue;
		total = addCost(total, sessionCost(session));
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
 * Every Gate the run asked, oldest first: when it opened and when it
 * closed. A Gate closes when its step ends or reopens, or at the next
 * run-level event (a stop ends the run, a resume asks again). Null while
 * it is open.
 */
export function deriveGateWaits(events: readonly LoggedEvent[]): GateWait[] {
	const waits: GateWait[] = [];
	// By step: a step has one open Gate at most.
	const open = new Map<string, GateWait>();
	for (const e of bySeq(events)) {
		if (e.type === "GateOpened" && e.stepId) {
			const wait: GateWait = { openedAt: e.at, closedAt: null };
			waits.push(wait);
			open.set(e.stepId, wait);
		} else if (
			(e.type === "StepEnded" || e.type === "StepReopened") &&
			e.stepId
		) {
			const wait = open.get(e.stepId);
			if (wait) wait.closedAt = e.at;
			open.delete(e.stepId);
		} else if (
			e.type === "RunStarted" ||
			e.type === "RunResumed" ||
			e.type === "RunEnded"
		) {
			for (const wait of open.values()) wait.closedAt = e.at;
			open.clear();
		}
	}
	return waits;
}

export type GateWait = { openedAt: number; closedAt: number | null };

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

/** The step and the calling steps (Call) it runs in, from the inside out. */
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

/** A running step's time budget, as the log has it, and when it counts from. */
export type StepClock = {
	step: DerivedStep;
	/** The step's time budget in ms, or null without one. */
	timeoutMs: number | null;
	/** The step's idle limit in ms, or null without one. */
	idleMs: number | null;
	/**
	 * When the step's node last entered: the budget counts from here, and
	 * so does the idle clock until the step's transcript has a later entry.
	 */
	since: number;
};

/**
 * The clocks of the steps that run now (open, and not parked at a Gate or
 * in a sleep) and have a budget in the log (`StepBudget`). A step's timers
 * start again each time its node enters, so `since` is the latest of: its
 * `StepStarted` or `StepReopened`, a `WaitEnded` or `ItemStarted` of its
 * own, and every event inside it (a step of the flow it calls, an edge
 * there). A Call node enters again after each wait, Gate and element in
 * its called flow, and the log has no mark of that entry: the events
 * inside stand in for it. So `since` can be late, never early.
 */
export function deriveStepClocks(events: readonly LoggedEvent[]): StepClock[] {
	const latest = latestRunEvent(events);
	if (!latest || latest.type === "RunEnded") return [];
	const steps = deriveSteps(events);
	const callerOf = new Map(steps.map((s) => [s.id, s.scope?.parentStepId]));
	const parked = new Set(parkedSteps(events).map((s) => s.id));
	const budgets = new Map<string, StepBudget>();
	const since = new Map<string, number>();
	const entered = (stepId: string, at: number) =>
		since.set(stepId, Math.max(since.get(stepId) ?? at, at));
	for (const e of bySeq(events)) {
		const own = e.stepId;
		if (own && (e.type === "StepStarted" || e.type === "StepReopened")) {
			budgets.set(own, e.payload);
			entered(own, e.at);
		} else if (own && (e.type === "WaitEnded" || e.type === "ItemStarted")) {
			entered(own, e.at);
		}
		const inside =
			e.type === "EdgeTaken"
				? e.payload.scope?.parentStepId
				: own
					? callerOf.get(own)
					: undefined;
		for (let caller = inside; caller; caller = callerOf.get(caller)) {
			entered(caller, e.at);
		}
	}
	return steps.flatMap((step) => {
		if (step.endedAt !== null || parked.has(step.id)) return [];
		const budget = budgets.get(step.id);
		const timeoutMs = budget?.timeoutMs ?? null;
		const idleMs = budget?.idleMs ?? null;
		if (timeoutMs === null && idleMs === null) return [];
		return [
			{ step, timeoutMs, idleMs, since: since.get(step.id) ?? step.startedAt },
		];
	});
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
