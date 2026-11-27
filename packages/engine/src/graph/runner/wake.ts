import type { JsonValue } from "@nightshift/flows";

import {
	type DerivedStep,
	type ResumedBy,
	type RunBus,
	type RunLog,
	type RunState,
	scopeKey,
} from "../../log";
import { firstDeadline, wakesNext } from "../../read";
import type { Recorder } from "../recorders";
import type { Parked, ResumeValue } from "../state";
import {
	type Interrupt,
	resumeEach,
	type ThreadEntry,
	type ThreadState,
} from "./thread";

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
	/** A timer that fired before its time: it is set again. */
	| { kind: "too-soon" }
	/**
	 * The step cannot go on before a Gate is answered: the Gate waits in a
	 * Call beside it, and a Call whose body waits ends no task
	 * (`driveGraph`). The step sleeps on, and its timer fires again after
	 * the answer.
	 */
	| { kind: "blocked" }
	/** The wait ends: `WaitEnded` on `step`, then `entry` into the thread. */
	| { kind: "wake"; step: Pick<DerivedStep, "id">; entry: ThreadEntry };

/**
 * Pure: what a wake does. The log says which steps sleep (`wakesNext`): it
 * was written first, and a person and the timers read it. A stop or recovery
 * ends a sleep there with the thread left at its wait. The thread says only
 * where each task is, so the wake moves every task that the log does not
 * hold asleep:
 *
 * - The step it wakes: its interrupt is answered.
 * - An interrupt whose step the log no longer holds asleep (the daemon died
 *   after the wake, or recovery ended the step): it is answered too.
 * - A task with no interrupt (the daemon died before it was saved): the
 *   drive runs it again, and its node goes on from the log.
 *
 * Every other interrupt, a sleeper or a Gate, gets a hold (`resumeEach`):
 * it keeps its wait, and the step that wakes goes on at once. A timer's
 * wake (`early` false) before the wait's time is too soon. A wake that a
 * Gate in a Call beside it holds back is `blocked` (`heldBack`).
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
	if (!asleepIn(run, at)) return { kind: "not-sleeping" };
	const sleeping = wakesNext(run, how.signal);
	const step = run.steps.get(sleeping?.stepId ?? "");
	if (!sleeping || !step) return { kind: "not-sleeping" };
	const { until } = sleeping.payload;
	if (!how.early && until !== null && now < until) {
		return { kind: "too-soon" };
	}
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
	const asleep = new Set(run.waits.map((wait) => wait.stepId));
	const interrupts = at.kind === "interrupted" ? at.interrupts : [];
	const pick = (value: Parked): ResumeValue | null => {
		if (value.kind !== "wait") return null;
		if (value.stepId === step.id) return resume;
		return asleep.has(value.stepId) ? null : { kind: "wake", early: false };
	};
	if (heldBack(run, step, interrupts, pick)) return { kind: "blocked" };
	const [only] = interrupts.filter(({ value }) => pick(value) !== null);
	if (!only) return { kind: "wake", step, entry: { kind: "continue" } };
	const each = resumeEach(at, pick);
	return {
		kind: "wake",
		step,
		entry: {
			kind: "resume",
			value: pick(only.value) ?? resume,
			...(each ? { each } : {}),
		},
	};
}

/**
 * Whether a Gate or a sleep that keeps its wait holds back the step that
 * wakes: it waits inside a Call at the step's own level. The step goes on
 * in the next super-step of that level, and the Call ends no task while
 * its body waits (`driveGraph`). The thread may not even hold the step's
 * wait yet: the step slept in the super-step the Call held back.
 */
function heldBack(
	run: RunState,
	step: DerivedStep,
	interrupts: readonly Interrupt[],
	pick: (value: Parked) => ResumeValue | null,
): boolean {
	const level = scopeKey(step.scope);
	return interrupts.some(({ value }) => {
		if (pick(value) !== null || value.stepId === null) return false;
		let at = run.steps.get(value.stepId)?.scope ?? null;
		while (at) {
			const caller = run.steps.get(at.parentStepId);
			if (!caller) return false;
			if (scopeKey(caller.scope) === level) return true;
			at = caller.scope;
		}
		return false;
	});
}

/**
 * Whether the run sleeps for a wake: the log holds a sleep, while the run
 * sleeps or waits at a Gate beside it. The wake holds the Gate
 * (`planWake`), so the Gate keeps its wait.
 */
function asleepIn(run: RunState, at: ThreadState): boolean {
	if (at.kind === "fresh" || at.kind === "ended") return false;
	if (run.status === "sleeping") return true;
	return run.status === "waiting" && run.waits.length > 0;
}

/** The run's next timer (`nextTimer`): when it fires, and the Gate whose deadline it is. */
export type NextTimer = {
	at: number;
	/** The open Gate whose deadline is due first. Null: a sleep wakes. */
	gate: ReturnType<typeof firstDeadline>;
};

/**
 * Pure: the run's one timer, from its log. It is the first of the wake
 * time of its sleeps and the deadlines of its open Gates: a Gate and a
 * sleep can wait at once on parallel branches. A deadline goes first when
 * both are at the same time. Null when nothing waits for a time (a signal
 * with no timeout, a Gate with no deadline).
 */
export function nextTimer(run: RunState): NextTimer | null {
	const until = run.sleep ? (wakesNext(run)?.payload.until ?? null) : null;
	const gate = firstDeadline(run);
	if (gate && (until === null || gate.deadline.at <= until)) {
		return { at: gate.deadline.at, gate };
	}
	return until === null ? null : { at: until, gate: null };
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
	 * Sets the run's timer from its log (`nextTimer`), or drops it when
	 * nothing waits for a time. A drive that parks sets it, a timer that
	 * fired too soon sets it again, and a new daemon gives each run its
	 * timer with it (the log stays the restart source).
	 */
	function restore(runId: string, run: RunState): void {
		const next = nextTimer(run);
		if (next) schedule(runId, next.at);
		else forget(runId);
	}

	return { schedule, restore, forget, dispose };
}
