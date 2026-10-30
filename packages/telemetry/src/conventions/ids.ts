import { createHash } from "node:crypto";

/**
 * The trace and span ids of a run, worked out from its ids alone. A run is
 * one trace, its first walk the root span, each step a span under it (or
 * under its Call step). Any process can name them with no state: the
 * export after a restart, and the Device that spawns a step's Claude Code
 * session, which gets the step's span as its parent (`TRACEPARENT`).
 */

function hex(text: string, length: number): string {
	return createHash("sha256").update(text).digest("hex").slice(0, length);
}

/** The run's trace id: 32 hex characters. */
export function traceIdOf(runId: string): string {
	return hex(`nightshift:trace:${runId}`, 32);
}

/** The span id of the run's first walk: the trace's root. */
export function runSpanIdOf(runId: string): string {
	return hex(`nightshift:run:${runId}`, 16);
}

/** The span id of a step's first part: what its sessions and its steps (a Call's) hang under. */
export function stepSpanIdOf(stepId: string): string {
	return hex(`nightshift:step:${stepId}`, 16);
}

/**
 * The span id of a later part of a run or step: a resumed walk, a step
 * that ended again after a reopen. `seq` is the event that ended it.
 */
export function laterSpanIdOf(id: string, seq: number): string {
	return hex(`nightshift:part:${id}:${seq}`, 16);
}

/** The span id of something inside a step: a Gate's wait, a sleep. */
export function innerSpanIdOf(
	stepId: string,
	kind: string,
	from: number,
): string {
	return hex(`nightshift:${kind}:${stepId}:${from}`, 16);
}

/** The W3C `traceparent` of a step's span: a session's parent. Sampled. */
export function stepTraceparent(runId: string, stepId: string): string {
	return `00-${traceIdOf(runId)}-${stepSpanIdOf(stepId)}-01`;
}
