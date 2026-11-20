import { NIGHT_RANGES, type NightRange } from "../../read";
import type { RunStatus } from "../../run-status";

/**
 * What every part of the dashboard measures with: the ranges of days and
 * hours, a cost, a spread, a run in a list and the counts.
 */

/** The day ranges the details offer: 7, 30 or 90 days. */
export { NIGHT_RANGES, type NightRange };

/** The hour ranges of the activity details: a day, two, a week. */
export const HOUR_RANGES = [24, 48, 168] as const;
export type HourRange = (typeof HOUR_RANGES)[number];

/** The runs an overview list shows. The full list is one link away. */
export const OVERVIEW_ROWS = 5;

/** The cost of several runs or steps together. */
export type KnownCost = {
	costUsd: number;
	/** Part of it is estimated from tokens. */
	costEstimated: boolean;
	/** Parts that ended without a cost: not in `costUsd`. */
	costMissing: number;
};

/** The five-number summary of a set of values, such as what runs cost. */
export type Spread = {
	min: number;
	q1: number;
	median: number;
	q3: number;
	max: number;
	/** How many values it covers. */
	count: number;
};

/** A run in a dashboard list: enough to show it and open it. */
export type DashboardRun = {
	id: string;
	title: string;
	status: RunStatus;
	createdAt: number;
	reason: string | null;
	wakeAt: number | null;
	branch: string;
	costUsd: number;
	costEstimated: boolean;
	costMissing: number;
	/** Tokens its agents used. Null when it used none, or reported none. */
	tokens: { input: number; output: number } | null;
	/** Its flow (on a project's dashboard), or its project (over all of them). */
	group: string;
	/**
	 * A test run (`isTestRun`): the nodes its start pinned and skipped, as
	 * on its run summary. Absent: no test run, or an older Host.
	 */
	test?: { pinned: string[]; skipped: string[] };
};

/** The first rows of a ranked list, and how many rows it has in all. */
export type TopRows<T> = { rows: T[]; count: number };

/** How many runs have one status. */
export type StatusCount = { status: RunStatus; count: number };

/**
 * One day and a count per key: a status, a Gate state, a spend group.
 * `night` is the start of the day.
 */
export type NightCounts = { night: number; counts: Record<string, number> };
