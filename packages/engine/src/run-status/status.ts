/**
 * How a run that an End node ended came out, as its flow chose. `done`
 * and `nothing-to-do` end the run `finished`, `failed` ends it `failed`.
 * A run that ended any other way has no result.
 */
export type RunResult = "done" | "nothing-to-do" | "failed";

/** Derived from the event log, never stored. */
export type RunStatus =
	| "running" // a step is in progress, or the walk is between steps
	| "waiting" // a Gate waits for a person in the Needs-you inbox
	| "sleeping" // a usage limit or a network failure: a timer continues the same session
	| "finished" // the walk reached `pass`, a Decision label or a Gate choice with no edge left to take
	| "stopped" // a person stopped the run
	| "failed" // a step errored, a `fail`/`needs-input` had no edge, or a loop hit its max
	| "interrupted"; // the daemon died while a step ran
