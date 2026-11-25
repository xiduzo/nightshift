import {
	RunRefusal,
	type RunResult,
	type RunStatus,
	refuseUnless,
	whyNot,
} from "../../../run-status";

/**
 * The rules of what a person does to a run, past its status (`run-status/`
 * has the status rule, which the screens read too). Each takes the shape
 * of the run it reads: the fold of the run log fits each one. A rule that
 * reads the log runs inside the run's Turn, so no other Turn comes between
 * the rule and the action.
 */

/** Why a resume does not travel: one is on its way to the run's Walker already. */
export const RESUME_ON_ITS_WAY =
	"A resume of this run is already on its way to the device that runs it.";

/** Throws for a prompt that no session takes: it would go to nobody. */
export function refusePrompt(takesPrompt: boolean): void {
	if (takesPrompt) return;
	throw new RunRefusal(
		"not-now",
		"No agent waits for a prompt in this run now. To continue the run, remove the prompt.",
	);
}

/** Throws unless the run sleeps in a Wait node that waits for the Signal `name`. */
export function refuseSignal(
	run: { status: RunStatus; sleep: { signal: string | null } | null },
	name: string,
): void {
	refuseUnless("signal", run.status, true);
	if (run.sleep?.signal !== name) {
		throw new RunRefusal(
			"wrong-signal",
			"This run does not wait for that signal.",
		);
	}
}

/** Throws unless the run holds the lease `name` now: a run that ended holds none. */
export function refuseRelease(
	run: { holds: readonly { kind: string; name?: string }[] },
	name: string,
): void {
	if (!run.holds.some((hold) => hold.kind === "lease" && hold.name === name)) {
		throw new RunRefusal(
			"not-now",
			`This run does not hold the lease "${name}" now.`,
		);
	}
}

/**
 * Throws why a restart is refused: the run runs no step, or `stepId` is
 * not a step that runs. `steps` are the run's steps, each with its end.
 */
export function refuseRestart(
	run: { status: RunStatus; end: { result: RunResult | null } | null },
	steps: readonly { id: string; endedAt: number | null }[],
	stepId: string | undefined,
): void {
	refuseUnless("restart", run.status, true, run.end?.result);
	const open = steps.filter((s) => s.endedAt === null);
	if (open.length === 0) {
		throw new RunRefusal(
			"no-step",
			"No step runs right now. Try again when the next step starts.",
		);
	}
	if (stepId !== undefined && !open.some((s) => s.id === stepId)) {
		throw new RunRefusal(
			"step-ended",
			"That step has ended. Restart the step that runs now.",
		);
	}
}

/**
 * Whether `by` took the step over before, in the run's current walk: a
 * take-over is logged once per step and person in a walk.
 */
export function takenOverBefore(
	run: {
		walk: { seq: number } | null;
		takeOvers: readonly {
			seq: number;
			stepId: string | null;
			payload: { by: string | null };
		}[];
	},
	stepId: string,
	by: string | null,
): boolean {
	const walkFrom = run.walk?.seq ?? Number.NEGATIVE_INFINITY;
	return run.takeOvers.some(
		(taken) =>
			taken.seq > walkFrom &&
			taken.stepId === stepId &&
			taken.payload.by === by,
	);
}

/**
 * What a stop after the running step logs: a request (`after`), or its
 * withdrawal. Null when the run has nothing to stop, or already says so.
 */
export function stopAfterStepEvent(
	run: { status: RunStatus; stopAfterStep: boolean },
	after: boolean,
): "StopAfterStepRequested" | "StopAfterStepCancelled" | null {
	if (whyNot("stop", run.status, true) !== null) return null;
	if (run.stopAfterStep === after) return null;
	return after ? "StopAfterStepRequested" : "StopAfterStepCancelled";
}

/** Whether a stop of a run another Device walks travels: a run that has ended has nothing to stop. */
export function stopTravels(run: { status: RunStatus }): boolean {
	return whyNot("stop", run.status, false) === null;
}
