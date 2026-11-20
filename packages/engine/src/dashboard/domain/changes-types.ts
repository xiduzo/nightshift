import type { NightRange } from "./measure-types";

/** The changes of a flow: each change, what the runs did before and after it, and the next change to try. */

/**
 * One change of a flow (Q17): saves less than 30 minutes apart that change
 * what a run does. A save that only moves steps on the canvas, and Night
 * Shift's own upgrade of a flow, are no change.
 */
export type FlowChange = {
	/** The first save of it. */
	firstAt: number;
	/** The last save of it. */
	at: number;
	saves: number;
	/** Steps added, removed and changed, added up over its saves. */
	added: number;
	removed: number;
	changed: number;
	/** Paths (edges) added, removed or changed. */
	edges: number;
	/** Inputs, outputs, variables, Sections and the flow's own fields that changed. */
	settings: number;
};

/** What a set of runs of a flow shows: one column of the before and after table. */
export type ChangeMeasure = {
	runs: number;
	finished: number;
	/** Unplanned step-ins per run. */
	unplanned: number;
	/** How long a run waited for a person, on average, in milliseconds. */
	waitMs: number;
	/** How long a finished run worked, Gate waits and sleeps left out: the median. Null when none finished. */
	workMs: number | null;
	/** What a finished run with a known cost cost: the median. Null when none did. */
	costUsd: number | null;
	/** Pull requests merged, and closed without a merge. */
	merged: number;
	closed: number;
	/** Runs a person found useful, of the runs with an answer. */
	useful: number;
	rated: number;
};

/** How a number moved: by less than 10% is the same. */
export const CHANGE_TRENDS = ["better", "same", "worse"] as const;
export type ChangeTrend = (typeof CHANGE_TRENDS)[number];

/** On the whole, on the finished share, the unplanned step-ins and the cost. `few`: under 3 runs on a side. */
export const CHANGE_VERDICTS = ["better", "same", "worse", "few"] as const;
export type ChangeVerdict = (typeof CHANGE_VERDICTS)[number];

/** Two sets of runs of a flow side by side: before, and after. */
export type ChangeComparison = {
	before: ChangeMeasure;
	after: ChangeMeasure;
	verdict: ChangeVerdict;
	/** How each number with a direction moved. */
	trends: Record<
		"finished" | "unplanned" | "waitMs" | "workMs" | "costUsd",
		ChangeTrend
	>;
};

/** One ended run of a flow on the timeline of its changes. */
export type ChangeRun = {
	runId: string;
	startedAt: number;
	finished: boolean;
	/** Unplanned step-ins. */
	unplanned: number;
	costUsd: number;
};

/** A guard that stopped runs, as a move names it. The idle guard is a `stalled` move. */
export const MOVE_GUARDS = ["budget", "turns", "looping", "max_steps"] as const;
export type MoveGuard = (typeof MOVE_GUARDS)[number];

/**
 * Why runs could not start their work, as a move names it: a hand-off to
 * another Device failed, the agent hit its usage limit, the network was
 * gone, or the agent was signed out. No change of the flow fixes it.
 */
export const MOVE_SETUP_CAUSES = [
	"handoff",
	"usageLimit",
	"network",
	"signedOut",
] as const;
export type MoveSetupCause = (typeof MOVE_SETUP_CAUSES)[number];

/**
 * One next change to try on a flow, read from its runs (Q15). Each names
 * the newest run that shows it: an agent reads that run to propose the
 * change.
 *
 * - `edge`: runs stopped at `nodeId` on an outcome no path leaves.
 * - `loopLimit`: a loop back to `nodeId` reached its most rounds.
 * - `setup`: runs could not do their work, for one `cause`.
 * - `unsure`: the model that decides at `nodeId` was seldom sure.
 * - `sameAnswer`: a person gave the same answer at the Gate `nodeId` 4 of 5 times or more.
 * - `notes`: a person sent the work of `step` back from the Gate `nodeId` with a note.
 * - `leftOpen`: runs ended while the Gate `nodeId` still waited.
 * - `wait`: runs waited for a person most of their time. `nodeId` is the
 *   Gate that holds most of the wait, and `waitMs` what it waited per time
 *   it asked. Without it, `waitMs` is the wait per run.
 * - `loop`: `from` sent the run back to `nodeId` on `outcome`. The loop can
 *   be one the flow draws on purpose: the extra rounds are what it costs.
 * - `endsRuns`: runs ended at `nodeId` without finishing.
 * - `guard`: a guard stopped runs.
 * - `stalled`: the agent at `nodeId` showed no activity, and its step stopped.
 * - `late`: scheduled runs started late.
 * - `rate`: few runs have an answer to "Was this run useful?".
 * - `nothing`: most runs found nothing to do.
 */
export type FlowMove = { runId: string } & (
	| { kind: "edge"; nodeId: string; outcome: string; runs: number }
	| { kind: "loopLimit"; nodeId: string; outcome: string; runs: number }
	| { kind: "setup"; cause: MoveSetupCause; runs: number }
	| {
			kind: "unsure";
			nodeId: string;
			unsure: number;
			picked: number;
			tier: string | null;
	  }
	| {
			kind: "sameAnswer";
			nodeId: string;
			choice: string;
			times: number;
			of: number;
			/** The Gate has a deadline already. */
			deadline: boolean;
	  }
	| {
			kind: "notes";
			nodeId: string;
			/** The agent step before the Gate: the work it judges. */
			step: string | null;
			notes: number;
			lastNote: string;
	  }
	| { kind: "leftOpen"; nodeId: string; open: number; asked: number }
	| {
			kind: "wait";
			nodeId: string | null;
			/** Of the time of the runs, 0 to 1. */
			share: number;
			waitMs: number;
			workMs: number;
	  }
	| {
			kind: "loop";
			nodeId: string;
			from: string;
			outcome: string;
			times: number;
			/** Rounds of `nodeId` per run that reached it. */
			rounds: number;
			/** What the extra rounds cost together. */
			extraUsd: number;
	  }
	| {
			kind: "endsRuns";
			nodeId: string;
			runs: number;
			of: number;
			agent: boolean;
	  }
	| { kind: "guard"; guard: MoveGuard; runs: number }
	| { kind: "stalled"; nodeId: string; runs: number }
	| { kind: "late"; late: number; scheduled: number; usualMs: number }
	| { kind: "rate"; rated: number; useful: number; runs: number }
	| { kind: "nothing"; nothing: number; runs: number }
);

/**
 * Before and after for one flow over the last `nights` days, today
 * included: the effect of its last change, the days against as many days
 * before, and the next changes to try.
 */
export type FlowChanges = {
	nights: NightRange;
	/** The days before start at `from`, the days at `split`, and `to` is now. */
	window: { from: number; split: number; to: number };
	/** The flow's own ended runs in the window, oldest first. No test run. */
	runs: ChangeRun[];
	/** Its changes in the window, oldest first. */
	changes: FlowChange[];
	/** The newest change, while no run ran after it. */
	pending: FlowChange | null;
	/**
	 * The newest change that a run ran after: the runs after it, up to the
	 * next change, against the 10 runs before it. Null without one.
	 */
	lastChange: (ChangeComparison & { change: FlowChange }) | null;
	/** The days against as many days before. */
	days: ChangeComparison;
	/** The most pressing first. */
	moves: FlowMove[];
	/** How many runs of the days the moves read. */
	read: number;
};
