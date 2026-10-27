import type { CostSource } from "@nightshift/agents/pricing";
import type {
	AgentErrorKind,
	AgentHarnessName,
	AgentUsage,
} from "@nightshift/agents/types";
import type { Database } from "@nightshift/db";
import { event, project, run } from "@nightshift/db/schema";
import type {
	FlowNodeType,
	ItemState,
	JsonValue,
	Outcome,
	OutcomeColor,
	WaitUntil,
} from "@nightshift/flows";
import { sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { RunResult, RunStatus } from "../run-status";
import { upgradePayload } from "./upgrade-payload";

/**
 * Every fact the engine appends to the event log, and how to append and read
 * one. The pure functions that derive state from the log are in
 * `read/derive-run.ts` and `read/derive-steps.ts`. Status, reasons, step summaries,
 * edge counts and node outputs are never stored anywhere else.
 *
 * Checkpoint rule: a fact goes into the log as soon as it happens, and a step
 * is closed (`StepEnded` with its outcome and outputs) before the walk picks
 * the next node. A daemon that dies can always continue from the log.
 *
 * Transcript chunks (text deltas, tool calls, command output) never go here:
 * they live in the NDJSON transcript files.
 *
 * A payload written in an older shape is read in today's shape
 * (`upgrade-payload.ts`).
 */

/** How a session ended. */
export type SessionOutcome = "finished" | "stopped" | "failed" | "interrupted";

/** How a run ended. `running` is never logged: it is the absence of an end. */
export type RunEnding = Exclude<RunStatus, "running">;

/** A step's template outputs: JSON values, so `{{planner.data.tasks}}` can take a path. */
export type StepOutputs = Record<string, JsonValue>;

/** Input values of a flow, by input name. */
export type InputValues = Record<string, JsonValue>;

/**
 * A Gate's deadline as the Gate opened with it: `at` (epoch ms) is when
 * the Gate takes the option `choose` if nobody answered.
 */
export type GateDeadline = { at: number; choose: string };

/**
 * One choice of a Gate: an option of its Decision node, with the colour the
 * node gives it, or a choice of an Agent that asks a person (`ask`).
 */
export type GateChoice = {
	name: string;
	description?: string;
	color?: OutcomeColor;
	/** The choice needs a note: the answer an Agent goes on with. */
	needsNote?: true;
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
export type ResumedBy = "person" | "daemon";
/** What a `RunResumed` did beyond a resume (`RunResumed.action`). */
export type ResumeAction = "restart" | "rerun";

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
		/** The profile's id; before profiles had ids, its name. */
		profile: string;
		/** The profile's name. Absent in an event logged before ids. */
		profileName?: string;
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
	 * Night Shift removed what a run left on this computer: its worktree
	 * (`worktreePath`, null when it stayed), local branches, or both.
	 * `by: "cleanup"` is the scheduled cleanup, `person` a person's action.
	 * A fact of this computer, not of the run: the event has no run, names
	 * the run in its payload, and the exchange does not copy it.
	 */
	WorktreeRemoved: {
		projectId: string;
		runId: string;
		worktreePath: string | null;
		branches: string[];
		by: "person" | "cleanup";
	};
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
	 * The new Walker has the run's Walk state from the archive, and walks
	 * it from here: its first event after `WalkerMoved`. Until the new
	 * Walker wrote to the run, the run still arrives, and it tries again
	 * (`runsArriving`).
	 */
	WalkerArrived: { from: string };
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
	 * The variables of a flow when it starts (each `initial`, or a kept
	 * value), in the scope the flow runs in: null at the top level of the
	 * run.
	 */
	VariablesSet: {
		values: Record<string, JsonValue>;
		scope: Scope | null;
		/**
		 * The kept variables (`keep`) that start from the value an earlier
		 * run left, not from `initial`. Absent when none does.
		 */
		kept?: string[];
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
		/**
		 * The flow author marked this Gate to be answered from the lock
		 * screen (`lockScreen` on its Decision). Written only when true, so
		 * absent in older logs and on every other Gate. Kept with the Gate,
		 * not read from the flow file, so an edit of the flow after it opened
		 * does not change it.
		 */
		lockScreen?: true;
		/**
		 * When nobody answered by then, the Gate takes an option (`deadline`
		 * on its Decision). Written only when the Gate has one, with the time
		 * rendered when it opened, so a restart keeps the same deadline.
		 */
		deadline?: GateDeadline;
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
		/**
		 * A Wait node on a signal with a `key`: the key, rendered. Only a
		 * webhook signal with the same key wakes it. Absent: any does.
		 */
		signalKey?: string;
		/** The Device the step waits for or on: a usage limit is its harness login's. */
		deviceId?: string;
		/** `device-offline`: the name of the Device it waits for, for a notification. */
		deviceName?: string;
	};
	/** The wait is over: the step continues. `early` when a person resumed the run; `signal` when one arrived. */
	WaitEnded: { early: boolean; signal?: string };
	StopRequested: Record<string, never>;
	/** A person asked to stop the run before its next step or item. */
	StopAfterStepRequested: Record<string, never>;
	/** A person withdrew the stop after the step: the run goes on. */
	StopAfterStepCancelled: Record<string, never>;
	/**
	 * `result`: the status of the End node that ended the run, as its flow
	 * chose (the reason is then the End's message). Absent for every other
	 * end, and in older logs.
	 */
	RunEnded: { status: RunEnding; reason: string | null; result?: RunResult };
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
	/**
	 * A webhook arrived for a schedule and its secret checked out: the
	 * schedule took it (`accepted`: it started a run, sent its signal, or
	 * tried to), or its `when` did not hold or failed (`filtered`). A
	 * webhook that was refused (no secret, a wrong one) is never logged:
	 * anyone may send one. Logged without a run id on the row. `at` is when
	 * it arrived.
	 */
	WebhookReceived: {
		projectId: string;
		scheduleId: string;
		at: number;
		result: "accepted" | "filtered";
		/** The run it started. */
		runId: string | null;
		/** How many runs its signal woke. */
		woke: number;
		/** Why the run did not start, or why the rule or the key failed. */
		error: string | null;
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
 * One event as this Replica's log has it. Any payload may also carry
 * `commandId`: the Command whose first event of its run this is
 * (`command-stamp.ts`). Readers of the payloads above never need it.
 */
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
 * Statements that commit in one batch with the events they go with:
 * `before` the events (the rows they name), `after` them (what the log
 * says now: a run's Walker, a session's harness id).
 */
export type EventWrites = {
	before?: readonly BatchItem<"sqlite">[];
	after?: readonly BatchItem<"sqlite">[];
};

/**
 * Appends one event as `walkerId`'s next and returns it as committed, with
 * its seq and time. The Walker's count (`walker_seq`) is taken in the same
 * statement, so two appends cannot get one number. The event's Space is
 * its run's, or for a fact of no run its project's (`payload.projectId`),
 * read in the same statement too. `writes` commit in one batch with the
 * event: a row and the event that names it land together or not at all.
 * The engine appends through its run log (`run-log.ts`), never here
 * directly.
 */
export async function appendEvent<T extends EngineEventType>(
	db: Database,
	input: EventInput<T>,
	walkerId: string,
	writes: EventWrites = {},
): Promise<LoggedEvent> {
	return parseEventRow(await appendEventRow(db, input, walkerId, writes));
}

/** `appendEvent`, as the row it committed: with its Space and its Walker's count. */
export async function appendEventRow<T extends EngineEventType>(
	db: Database,
	input: EventInput<T>,
	walkerId: string,
	writes: EventWrites = {},
): Promise<typeof event.$inferSelect> {
	const insert = db
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
	const before = writes.before ?? [];
	const after = writes.after ?? [];
	const [row] =
		before.length === 0 && after.length === 0
			? await insert
			: ((
					await db.batch([...before, insert, ...after] as unknown as [
						BatchItem<"sqlite">,
						...BatchItem<"sqlite">[],
					])
				)[before.length] as (typeof event.$inferSelect)[]);
	if (!row) throw new Error(`Could not append ${input.type}.`);
	return row;
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

/**
 * An event as it landed in this Replica: with its Space, and its identity,
 * its Walker and its number among that Walker's events (`walker_seq`).
 */
export type LandedEvent = LoggedEvent & {
	spaceId: string;
	walkerId: string;
	walkerSeq: number;
};

/** The event of a committed row, as it landed. `logged`: the row, parsed. */
export function landedEvent(
	row: typeof event.$inferSelect,
	logged: LoggedEvent,
): LandedEvent {
	return {
		...logged,
		spaceId: row.spaceId,
		walkerId: row.walkerId,
		walkerSeq: row.walkerSeq,
	};
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

/** Derived from the event log, never stored (`run-status/`). */
export type { RunResult, RunStatus };

/**
 * How one visit of a node ended: one of the node's outcomes (`pass`, a
 * Decision label, a Gate choice, …) or one of the reserved values below.
 */
export type StepOutcome =
	| Outcome
	| "error" // the harness or the command could not run, or the step timed out
	| "stopped" // a person stopped the run
	| "interrupted"; // the daemon died while the step ran

/** What started a run: a person, or a schedule of `.nightshift/schedules.json` at a cron time or on a webhook. */
export type RunTrigger =
	| { kind: "manual" }
	/** `at`: the cron time the run started for (epoch ms). */
	| { kind: "schedule"; scheduleId: string; at: number }
	/** `at`: when the webhook arrived (epoch ms). */
	| { kind: "webhook"; scheduleId: string; at: number };
