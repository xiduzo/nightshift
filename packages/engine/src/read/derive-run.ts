import {
	type GateChoice,
	type InputValues,
	type LoggedEvent,
	type RunStatus,
	type RunTrigger,
	type RunWarningKind,
	type StepBudget,
	scopeKey,
	type WaitReason,
} from "../log";
import {
	bySeq,
	type DerivedStep,
	deriveSteps,
	type EventOf,
	ofType,
	withEnclosing,
} from "./derive-steps";
import type { RunResume, ScopeTraversals } from "./views";

/**
 * Pure projections of a run's event log onto the run as a whole: its status
 * and end, its sleep, Gate, stop time, resumes, inputs and the clocks of
 * its running steps. Nothing here is stored: the log is the only source.
 */

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
 * `interrupted`. `steps`: the run's steps when the caller derived them
 * already (`deriveSteps`), else they are derived when needed.
 */
export function deriveRunState(
	events: readonly LoggedEvent[],
	steps?: readonly DerivedStep[],
): {
	status: RunStatus;
	reason: string | null;
} {
	const latest = latestRunEvent(events);
	if (!latest) return { status: "interrupted", reason: null };
	if (latest.type === "RunEnded") {
		return { status: latest.payload.status, reason: latest.payload.reason };
	}
	if (deriveOpenGate(events, steps)) return { status: "waiting", reason: null };
	if (deriveSleep(events, steps)) return { status: "sleeping", reason: null };
	return { status: "running", reason: null };
}

export function deriveRunStatus(events: readonly LoggedEvent[]): RunStatus {
	return deriveRunState(events).status;
}

/** Whether a run with this status is still open: at work, waiting at a Gate, or asleep. */
export function isOpenStatus(status: RunStatus): boolean {
	return status === "running" || status === "waiting" || status === "sleeping";
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
 * has not ended. `steps` as for `deriveRunState`.
 */
export function deriveSleep(
	events: readonly LoggedEvent[],
	steps?: readonly DerivedStep[],
): SleepFact | null {
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
	const step = (steps ?? deriveSteps(events)).find((s) => s.id === stepId);
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

/**
 * How often each called flow took each of its edges: one entry per scope
 * (a Call step, or one element of a Call with `each`) that took an edge,
 * in the order of its first edge. The top level is `deriveTraversals`.
 */
export function deriveCalledTraversals(
	events: readonly LoggedEvent[],
): ScopeTraversals[] {
	const scopes = new Map<string, ScopeTraversals>();
	for (const e of ofType(events, "EdgeTaken")) {
		const scope = e.payload.scope;
		if (!scope) continue;
		const key = scopeKey(scope);
		const entry = scopes.get(key) ?? {
			scope: { parentStepId: scope.parentStepId, itemId: scope.itemId },
			traversals: {},
		};
		scopes.set(key, entry);
		entry.traversals[e.payload.edgeId] =
			(entry.traversals[e.payload.edgeId] ?? 0) + 1;
	}
	return [...scopes.values()];
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

export type OpenGateFact = {
	stepId: string;
	nodeId: string;
	visit: number;
	question: string;
	choices: GateChoice[];
	/** The flow author let a person answer this Gate from the lock screen. */
	lockScreen: boolean;
	openedAt: number;
};

/**
 * The Gate the run waits at: a Gate step that opened and has not ended,
 * while the run has not ended. A Gate step that started but never wrote
 * `GateOpened` (the daemon died in between) is not open: recovery
 * interrupts it like any other step. `steps` as for `deriveRunState`.
 */
export function deriveOpenGate(
	events: readonly LoggedEvent[],
	steps?: readonly DerivedStep[],
): OpenGateFact | null {
	const latest = latestRunEvent(events);
	if (!latest || latest.type === "RunEnded") return null;
	const walkBegan = latest.seq;
	const open = (steps ?? deriveSteps(events)).findLast(
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
		lockScreen: open.gate.lockScreen,
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
