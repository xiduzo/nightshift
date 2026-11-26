import type { JsonValue } from "@nightshift/flows";

import type {
	DerivedStep,
	ResumedBy,
	RunBus,
	RunLog,
	RunState,
} from "../../log";
import { firstDeadline, wakesNext } from "../../read";
import type { Recorder } from "../recorders";
import type { ResumeValue } from "../state";
import type { ThreadEntry, ThreadState } from "./thread";

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
 * Every other sleeper keeps its wait. A timer's wake (`early` false) before
 * the wait's time is too soon.
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
		return { kind: "too-soon", until };
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
	const each: Record<string, ResumeValue> = {};
	for (const { id, value } of interrupts) {
		if (value.kind !== "wait") continue;
		if (value.stepId === step.id) each[id] = resume;
		else if (!asleep.has(value.stepId)) {
			each[id] = { kind: "wake", early: false };
		}
	}
	const answers = Object.values(each);
	const [only] = answers;
	if (!only) return { kind: "wake", step, entry: { kind: "continue" } };
	return {
		kind: "wake",
		step,
		entry: {
			kind: "resume",
			value: only,
			...(interrupts.length > 1 ? { each } : {}),
		},
	};
}

/**
 * Whether the run sleeps for a wake: the log says it sleeps, or it says a
 * Gate waits while the thread holds the Gate's answer already. An Agent's
 * Gate closes in the log only when its step goes on, in the super-step
 * after the answer, and that super-step comes only once the sleepers beside
 * it woke. So the log still reads "waiting" while the run sleeps.
 */
function asleepIn(run: RunState, at: ThreadState): boolean {
	if (at.kind === "fresh" || at.kind === "ended") return false;
	if (run.status === "sleeping") return true;
	return run.status === "waiting" && run.waits.length > 0 && !holdsGate(at);
}

/** Whether the thread sits at a Gate that waits for its answer. */
export function holdsGate(at: ThreadState): boolean {
	return (
		at.kind === "interrupted" &&
		at.interrupts.some(({ value }) => value.kind === "gate")
	);
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
		// One timer per run: the first of a sleep and a Gate's deadline. A
		// Gate and a sleep can wait at once on parallel branches.
		const until = run.sleep ? wakesNext(run)?.payload.until : null;
		const deadline = firstDeadline(run)?.deadline.at;
		const first = Math.min(
			until ?? Number.POSITIVE_INFINITY,
			deadline ?? Number.POSITIVE_INFINITY,
		);
		if (first !== Number.POSITIVE_INFINITY) schedule(runId, first);
	}

	return { schedule, restore, forget, dispose };
}
