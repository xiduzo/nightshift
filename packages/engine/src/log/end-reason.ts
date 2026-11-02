/**
 * Why a run ended, as a code. The sentence a person reads stays in
 * `RunEnded.reason`. A code this build cannot prove is `_OTHER`.
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

const GUARDS = new Set<string>([
	"budget",
	"turns",
	"looping",
	"idle",
	"max_steps",
]);

const STOP_TIME = "Reached the stop time";
const STOP_AFTER_STEP = "Stopped after the running step, as asked.";

/**
 * The code the facts prove. `guard` wins, so a wrapped failure still names
 * the guard that stopped the step. A usage limit and a network failure are
 * read before the stop time: a wait past the stop time sets both.
 */
export function provedEndReason(input: {
	status:
		| "finished"
		| "failed"
		| "stopped"
		| "interrupted"
		| "waiting"
		| "sleeping";
	reason: string | null;
	result?: "done" | "nothing-to-do" | "failed" | null;
	atStopTime?: boolean;
	guard?: string | null;
}): RunEndReason {
	const reason = input.reason ?? "";
	if (input.guard && GUARDS.has(input.guard)) {
		return `guard.${input.guard}` as RunEndReason;
	}
	if (reason.includes("Usage limit:")) return "agent.usage_limit";
	if (
		reason.includes("The network is down:") ||
		reason.includes("The network was down")
	) {
		return "agent.network";
	}
	if (input.atStopTime || reason === STOP_TIME) return "stop_time";
	if (reason.includes("The run spent $") && reason.includes("budget")) {
		return "guard.budget";
	}
	if (
		reason.includes("reached its limit of") &&
		reason.includes("turns, so the step stopped")
	) {
		return "guard.turns";
	}
	if (reason.includes("times in a row with the same input")) {
		return "guard.looping";
	}
	if (reason.includes("showed no activity")) return "guard.idle";
	if (reason.includes("reached the limit of") && reason.includes("steps")) {
		return "guard.max_steps";
	}
	if (
		input.status === "stopped" &&
		(reason === "" || reason === STOP_AFTER_STEP)
	) {
		return "stopped_by_person";
	}
	if (input.status === "finished" && input.result !== "failed") {
		return "finished";
	}
	return "_OTHER";
}
