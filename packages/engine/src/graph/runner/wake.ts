import type { JsonValue } from "@nightshift/flows";

import type {
	DerivedStep,
	ResumedBy,
	RunBus,
	RunLog,
	RunState,
} from "../../log";
import { firstDeadline } from "../../read";
import type { Recorder } from "../recorders";
import type { Parked, ResumeValue } from "../state";
import type { ThreadState } from "./thread";

/**
 * The runner's side of a sleep (`step/sleep.ts` has the step's side).
 * `planWake` (pure) says what a wake does: the run still sleeps in the log
 * and in the checkpoint, a timer before its time is set again, and the
 * resume value for the wait node. `recordWake` appends `WaitEnded` and the
 * transcript `wake`. `createSleeps(deps)` holds the wake timers, and
 * `restore(runId, run)` gives a new daemon its timers from `deriveSleep`
 * (the log stays the restart source). The slot, the run cap and the drive
 * into the wait node are the runner's: it wakes a run in a Turn (`take`).
 */

/** setTimeout cannot wait longer; a longer wait checks the clock and waits again. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * How a sleep ends: the timer, a person early (with a follow-up), or a
 * signal, with the webhook event that sent it as `data`. `by`: who ended
 * it early without a signal, a person or the daemon (a Device came back,
 * a lease went).
 */
export type Wake = {
	early: boolean;
	prompt?: string;
	signal?: string;
	data?: JsonValue;
	by?: ResumedBy;
};

/** What a wake does to a run, from its log and its thread (`planWake`). */
export type WakePlan =
	/** The run no longer sleeps (a stop ended the sleep, or it woke already): nothing happens. */
	| { kind: "not-sleeping" }
	/** A timer that fired before its time: it is set again for `until`. */
	| { kind: "too-soon"; until: number }
	/** The wait ends: `WaitEnded` on `step`, then `resume` into the wait node. */
	| {
			kind: "wake";
			step: Pick<DerivedStep, "id">;
			resume: ResumeValue;
	  };

/**
 * Pure: what a wake does. The run must still sleep by the log (a stop ends
 * the sleep with the thread left at its wait) and by the checkpoint (the
 * wait is the interrupt the thread sits at). A timer's wake (`early`
 * false) before the wait's time is too soon.
 *
 * `early`: a person resumed the run before its time, with `prompt` as the
 * step's follow-up. `signal`: someone sent the run that signal; the resume
 * is `{ kind: "signal" }` and the Wait node on it ends `done`.
 */
export function planWake(
	run: RunState,
	at: ThreadState,
	how: Wake,
	now: number,
): WakePlan {
	if (run.status !== "sleeping") {
		return { kind: "not-sleeping" };
	}
	if (at.kind !== "interrupted") return { kind: "not-sleeping" };
	const sleeping = sleepingBranch(run, at, how);
	if (!sleeping) return { kind: "not-sleeping" };
	if (!how.early && sleeping.until !== null && now < sleeping.until) {
		return { kind: "too-soon", until: sleeping.until };
	}
	const step = run.steps.get(sleeping.stepId);
	if (!step) throw new Error(`Step not found: ${sleeping.stepId}`);
	const resume: ResumeValue =
		how.signal !== undefined
			? {
					kind: "signal",
					name: how.signal,
					...(how.data !== undefined ? { data: how.data } : {}),
				}
			: {
					kind: "wake",
					early: how.early,
				};
	return { kind: "wake", step, resume };
}

/**
 * The wait a wake ends. One wait: the one the thread sits at. Parallel
 * branches may sleep at once: a signal ends the wait for that signal, and
 * a timer or a person the one that wakes first. A wait whose step a stop
 * ended does not count.
 */
function sleepingBranch(
	run: RunState,
	at: Extract<ThreadState, { kind: "interrupted" }>,
	how: Wake,
): Extract<Parked, { kind: "wait" }> | null {
	const waits = at.interrupts.flatMap(({ value }) =>
		value.kind === "wait" && run.steps.get(value.stepId)?.endedAt === null
			? [value]
			: [],
	);
	if (waits.length < 2) {
		return at.value.kind === "wait" ? at.value : (waits[0] ?? null);
	}
	if (how.signal !== undefined) {
		const forSignal = waits.find((wait) =>
			run.steps
				.get(wait.stepId)
				?.sleeps.some((sleep) => sleep.signal === how.signal),
		);
		if (forSignal) return forSignal;
	}
	const first = (wait: { until: number | null }) =>
		wait.until ?? Number.POSITIVE_INFINITY;
	return [...waits].sort((a, b) => first(a) - first(b))[0] ?? null;
}

/** What `recordWake` writes to. */
export type WakeDeps = {
	log: RunLog;
	bus: RunBus;
	recorders: {
		open(runId: string, stepId: string): Promise<Recorder>;
	};
};

/**
 * Records the end of a sleep: `WaitEnded` on the step that waited, the
 * transcript `wake` entry, and the bus. The runner calls it in the wake's
 * Turn, once the woken run holds a slot and before the thread moves.
 */
export async function recordWake(
	deps: WakeDeps,
	runId: string,
	plan: Extract<WakePlan, { kind: "wake" }>,
	how: Wake,
): Promise<void> {
	const { step } = plan;
	const signal = how.signal !== undefined ? { signal: how.signal } : {};
	// Who woke it counts only without a signal: the signal says what woke it.
	const by =
		how.early && how.signal === undefined && how.by ? { by: how.by } : {};
	await deps.log.append({
		type: "WaitEnded",
		runId,
		stepId: step.id,
		payload: {
			early: how.early,
			...signal,
			...by,
			...(how.prompt !== undefined ? { prompt: how.prompt } : {}),
		},
	});
	const recorder = await deps.recorders.open(runId, step.id);
	try {
		recorder.record(null, { type: "wake", ...signal });
	} finally {
		recorder.close();
	}
	deps.bus.publish(runId, { kind: "step-changed", stepId: step.id });
}

/** What the wake timers need: the clock, and who wakes a run when its timer fires. */
export type SleepDeps = {
	now(): number;
	/** The timer of the run fired: the runner takes the run to wake it. */
	wake(runId: string): void;
};

/**
 * The wake timers of sleeping runs, and of runs that wait at a Gate with a
 * deadline. One per runner, one timer per run. A timer that fires hands
 * the run to `deps.wake`; the runner then wakes it in a Turn (`planWake`,
 * `recordWake`) or answers its Gate, or queues it on a full run cap.
 */
export function createSleeps(deps: SleepDeps) {
	/** Timers that end the waits of sleeping runs, by run id. */
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	let disposed = false;

	/** Clears every timer and sets no new one: the daemon dies. */
	function dispose(): void {
		disposed = true;
		for (const timer of timers.values()) clearTimeout(timer);
		timers.clear();
	}

	/** Drops the run's timer: the run woke, was stopped, or moved. */
	function forget(runId: string): void {
		const timer = timers.get(runId);
		if (timer !== undefined) clearTimeout(timer);
		timers.delete(runId);
	}

	/** Wakes the run at `until` (at once when it has passed). Replaces an earlier timer. */
	function schedule(runId: string, until: number): void {
		forget(runId);
		if (disposed) return;
		const delay = Math.min(Math.max(0, until - deps.now()), MAX_TIMER_MS);
		const timer = setTimeout(() => {
			timers.delete(runId);
			deps.wake(runId);
		}, delay);
		timer.unref?.();
		timers.set(runId, timer);
	}

	/**
	 * A new daemon's timer for a run that slept when the last one died, from
	 * the log (`deriveSleep`: the latest `WaitStarted` with no `WaitEnded`,
	 * on an open step of a run that has not ended). A wait with no time (a
	 * signal with no timeout) gets no timer. A run that waits at a Gate with
	 * a deadline gets the deadline's timer: the runner answers the Gate when
	 * it fires.
	 */
	function restore(runId: string, run: RunState): void {
		const sleeping = run.sleep;
		if (sleeping?.until != null) schedule(runId, sleeping.until);
		const deadline = firstDeadline(run)?.deadline;
		if (deadline) schedule(runId, deadline.at);
	}

	return { schedule, restore, forget, dispose };
}
