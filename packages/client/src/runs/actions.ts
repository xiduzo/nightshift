/**
 * Which actions a run allows now, and why not: the engine's one rule, which
 * its refusals follow too. A screen offers only what it allows, from the
 * status it shows (the live one too) and whether the computer it talks to
 * walks the run (`run.walker.thisDevice`).
 */

import { runActions } from "@nightshift/engine/run-status";

import type { RunResult, RunStatus } from "./types";

export {
	type RunActions,
	runActions,
	whyNot,
} from "@nightshift/engine/run-status";

/**
 * An action the person took on a run, on its way: sent (`settled` false)
 * or taken by Night Shift (`settled` true). Null when there is none.
 */
export type RunActing = {
	action: "stop" | "resume" | "restart" | "rerun";
	settled: boolean;
} | null;

/** The status each action leads to. */
const RESULT_OF: Record<NonNullable<RunActing>["action"], RunStatus> = {
	stop: "stopped",
	resume: "running",
	restart: "running",
	rerun: "running",
};

/**
 * The status a run shows, with the result of an action on its way at
 * once. It shows the result while the action is sent, and after, until the
 * run's own status no longer allows the action: then the run got there.
 * A run again is allowed after the run ends again too: the screen lets
 * go of it once the run is on its way.
 */
export function actedRunStatus(
	run: { status: RunStatus; result: RunResult | null; walkedHere: boolean },
	acting: RunActing,
): { status: RunStatus; result: RunResult | null } {
	const real = { status: run.status, result: run.result };
	if (!acting) return real;
	const allowed = runActions(run.status, run.walkedHere, run.result)[
		acting.action
	];
	if (acting.settled && !allowed) return real;
	return { status: RESULT_OF[acting.action], result: null };
}
