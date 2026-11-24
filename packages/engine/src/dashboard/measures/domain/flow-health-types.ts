import type { RunResult, RunStatus } from "../../../run-status";
import type { Spread } from "./measure-types";
import type { NeededYouReason } from "./runs";
import type { CostSteadiness } from "./spend-types";

/**
 * The health of a flow: its row on the dashboard and the watch over it.
 */

/**
 * A run's report (ADR 26) as a list shows it: the run, the End step that
 * wrote it (the run page opens there), when the run ended, how it came out,
 * and the start of the report (`RunIn.report`). Never its full text.
 */
export type LatestReport = {
	runId: string;
	stepId: string;
	endedAt: number;
	/** How the End node that ended the run says it came out. */
	result: RunResult;
	/** At most 600 characters of its Markdown, cut at a line break. */
	excerpt: string;
	/** The report goes on after the excerpt. */
	more: boolean;
};

/** A flow's last run. */
export type LastFlowRun = {
	runId: string;
	status: RunStatus;
	startedAt: number;
};

/** How many of a flow's last runs a Flow health row carries. */
export const LAST_FLOW_RUNS = 10;

/**
 * One row of Flow health: a flow over the last days. A test run
 * (`isTestRun`) is not in it: not in its last runs, its numbers or its
 * report.
 */
export type FlowHealthRow = {
	name: string;
	last: LastFlowRun | null;
	/** Its last runs, at most {@link LAST_FLOW_RUNS}, newest first, of any day. */
	lastRuns: LastFlowRun[];
	/** Runs in the last days, on its own and as a subflow. */
	runs: number;
	/** Percent of ended runs that finished. Null when none ended. */
	rate: number | null;
	/** What a finished run that asked an agent or model cost. Null when none did. */
	cost: Spread | null;
	/**
	 * What a finished run in `cost` used, the same runs. Null when one of
	 * them did not report its tokens, so the two spreads would not match.
	 */
	tokenUse: Spread | null;
	/** The runs that ended without finishing, and what they spent together. */
	unfinished: { count: number; costUsd: number; tokens: number };
	/** Finished runs with a step whose cost is not known: not in `cost`. */
	unknownCost: number;
	/** Finished runs that asked no agent or model: not in `cost`. */
	freeRuns: number;
	/**
	 * The newest report of its own runs, of any day, like `lastRuns`. Absent:
	 * no run of its own wrote one.
	 */
	report?: LatestReport;
	/** Its level, how often it needed a person, and its signals. */
	watch: FlowWatch;
	/**
	 * How steady its finished runs are: what one costs, and how long one
	 * works. Null with too few of them.
	 */
	steady: { cost: CostSteadiness | null; time: CostSteadiness | null };
};

/** The level of a flow: how much a person is still in its runs. */
export const FLOW_LEVELS = ["decide", "check", "own"] as const;
/** `decide`: You decide. `check`: You check. `own`: On its own. */
export type FlowLevel = (typeof FLOW_LEVELS)[number];

/** How often a person stepped in, as the flow draws it or not. */
export type AttentionCount = { planned: number; unplanned: number };

/** One reason a flow needed a person, at one node. */
export type AttentionCause = {
	reason: NeededYouReason;
	planned: boolean;
	times: number;
	/** A Gate or an Ask: its node. */
	nodeId?: string;
	/** A Gate or an Ask: the start of its newest question. */
	question?: string;
};

/**
 * How often the runs of a flow that started in the days needed a person.
 * It counts each step-in, not each run: a run that needed you twice
 * counts twice.
 */
export type FlowAttention = AttentionCount & {
	/** The same over as many days just before. */
	before: AttentionCount;
	/** Why, the unplanned first, then the most times. */
	causes: AttentionCause[];
	/** The unplanned step-ins per week, oldest first, the last week ending now. */
	perWeek: number[];
};

/**
 * One way a flow left its usual range. `failing`: its last runs failed.
 * `nothing`: its last runs found nothing to do, and its runs before
 * mostly did. `cost`, `length`: its last finished run cost more or worked
 * longer than every run before it, and over twice their median. `slow`:
 * the same for a run that still works.
 */
export type FlowSignal = {
	kind: "failing" | "nothing" | "cost" | "length" | "slow";
	/** It needs a look now. */
	severe: boolean;
	/** When it began: the start of the first run of it. */
	since: number;
	/** The newest run that shows it. */
	runId: string;
	/** `failing`, `nothing`: how many runs in a row. */
	count?: number;
	/** `cost`: dollars. `length`, `slow`: milliseconds at work. */
	now?: number;
	/** The lowest and the highest of the runs before, in the unit of `now`. */
	usual?: { low: number; high: number };
};

/** The watch over one flow (`watch.ts`). */
export type FlowWatch = {
	/** Its level, and since when. Null with too few ended runs. */
	level: { level: FlowLevel; since: number } | null;
	attention: FlowAttention;
	/** How long a finished run of the days worked, in milliseconds. Null when none finished. */
	length: Spread | null;
	/** The severe first. Empty: it does what it usually does. */
	signals: FlowSignal[];
};

/** A flow with a signal, over all the runs of a dashboard. */
export type WatchedFlow = {
	/** The project and the flow: `<projectId>/<flow>`. */
	key: string;
	projectId: string;
	flow: string;
	level: FlowWatch["level"];
	signals: FlowSignal[];
	/** When its newest run started. */
	lastAt: number;
};

/** The watch over every flow of a dashboard. */
export type SpaceWatch = {
	/** The unplanned step-ins per week, oldest first, the last week ending now. */
	perWeek: number[];
	/** How many flows are at each level. */
	levels: Record<FlowLevel, number>;
	/** How many flows it watches: those with a real run. */
	watched: number;
	/** The flows with a signal, the severe first. */
	flows: WatchedFlow[];
};
