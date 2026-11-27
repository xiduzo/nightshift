/**
 * Why a run ended, as a code. The sentence a person reads stays in
 * `RunEnded.reason`. The writer that knows the cause gives the code beside
 * the sentence: no reader finds it in the words. A cause without a code of
 * its own is `_OTHER`.
 */

export const RUN_END_REASONS = [
	"finished",
	"guard.budget",
	"guard.turns",
	"guard.looping",
	"guard.idle",
	"guard.max_steps",
	"stop_time",
	"agent.usage_limit",
	"agent.network",
	"agent.signed_out",
	"stopped_by_person",
	"_OTHER",
] as const;

export type RunEndReason = (typeof RUN_END_REASONS)[number];

/** A guard that stopped a step. The idle guard's warning kind is `stalled`. */
export type StepGuard = "budget" | "turns" | "looping" | "idle" | "max_steps";

const GUARD_ENDS = {
	budget: "guard.budget",
	turns: "guard.turns",
	looping: "guard.looping",
	idle: "guard.idle",
	max_steps: "guard.max_steps",
} as const satisfies Record<StepGuard, RunEndReason>;

/** The code of a run that a guard of the run policy stopped (`StepEnded.guard`). */
export function guardEndReason(guard: StepGuard): RunEndReason {
	return GUARD_ENDS[guard];
}
