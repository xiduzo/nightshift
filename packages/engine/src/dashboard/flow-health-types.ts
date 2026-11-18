import type { RungBy } from "../log";
import type { Ladder, NeededYouReason, Rung } from "../read";
import type { RunResult, RunStatus } from "../run-status";
import type {
	KnownCost,
	NightCounts,
	NightRange,
	Spread,
	StatusCount,
	TopRows,
} from "./measure-types";
import type { CostSteadiness } from "./spend-types";

/**
 * The health of a flow: its row on the dashboard, the watch over it, its
 * ladders, and the flow in detail behind the row.
 */

/** Why runs needed you: one reason, and how many runs had it. */
export type NeededReasonCount = { reason: NeededYouReason; runs: number };

/**
 * A run's report (ADR 26) as a list shows it: the run, the End step that
 * wrote it (the run page opens there), when the run ended, how it came out,
 * and the start of the report (`RunSummary.report`). Never its full text.
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
	finished: number;
	ended: number;
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
	/** Its runs' scores in the last days, the most scored first. Empty when none scored. Older Hosts send none. */
	scores?: FlowScoreRow[];
	/** What people answered to "Was this run useful?" in the last days. Older Hosts send none. */
	useful?: FlowUseful;
	/** How often its runs needed you in the last days, and why. Older Hosts send none. */
	neededYou?: FlowNeededYou;
	/**
	 * The newest report of its own runs, of any day, like `lastRuns`. Absent:
	 * no run of its own wrote one, or an older Host.
	 */
	report?: LatestReport;
	/** Where the work of its own runs landed in the last days. Older Hosts send none. */
	ladders?: FlowLadders;
	/** Its level, how often it needed a person, and its signals. Older Hosts send none. */
	watch?: FlowWatch /**
	 * How steady its finished runs are: what one costs, and how long one
	 * works. Null with too few of them. Older Hosts send none.
	 */;
	steady?: { cost: CostSteadiness | null; time: CostSteadiness | null };
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

/**
 * One rung of a flow's ladder over some days: how often a climb landed on
 * it, and what a landing there cost on average, every try before it
 * included. Tiers of the same name merge, over all the flow's nodes. A
 * person, a deadline, a rule and `none` are one rung each: `tier` is null
 * on them. `tier` is null too on a node without a Cascade: `by` names it.
 */
export type LadderRungRow = {
	rung: Rung;
	by: RungBy;
	tier: string | null;
	/** How many climbs landed on it. */
	landed: number;
	/** What its landings cost, divided by `landed`. */
	costPerLanding: KnownCost;
};

/** Where the climbs of one ladder landed: the rungs in ladder order, the cheapest first. */
export type LadderSummary = {
	/** All its landings. */
	landed: number;
	rungs: LadderRungRow[];
};

/** The choice ladder also counts how sure its deciders were. */
export type ChoiceLadderSummary = LadderSummary & {
	/** Decisions a decider gave a probability on. */
	picked: number;
	/** Of them, the Decisions a decider was not sure enough on: below `minConfidence`. */
	unsure: number;
};

/**
 * Where the work of a flow's own runs landed (Q31): the work ladder
 * (Agent, Subflow, Value by a model, Ask) and the choice ladder
 * (Decisions). A run as a subflow counts in the run that called it. Null
 * when nothing landed on that ladder.
 */
export type FlowLadders = {
	work: LadderSummary | null;
	choice: ChoiceLadderSummary | null;
};

/** One node's ladder in a flow's detail. */
export type NodeLadder = {
	/** `<ladder>/<via>/<nodeId>`. */
	key: string;
	ladder: Ladder;
	nodeId: string;
	/** The Subflow nodes it ran in, outermost first, joined by `/`. Absent at the top level. */
	via?: string;
	landed: number;
	/** What its landings cost, divided by `landed`. */
	costPerLanding: KnownCost;
	rungs: LadderRungRow[];
	/** A Decision only: as on the choice ladder. */
	picked?: number;
	/** A Decision only: as on the choice ladder. */
	unsure?: number;
};

/** A flow's ladders in its detail, with the nodes that landed most. */
export type FlowRangeLadders = FlowLadders & {
	/** The most landings first. */
	nodes: TopRows<NodeLadder>;
};

/**
 * One day of a flow: its runs per status, and what the Metrics tab charts.
 * `night` is the start of the day. Older Hosts send only `night` and `counts`.
 */
export type FlowDay = NightCounts & {
	/** What its runs that started this day spent, on its own and as a subflow. */
	spent?: KnownCost;
	/** Its own runs that started this day, and how many of them needed you. */
	needed?: { runs: number; needed: number };
	/**
	 * Per metric name (a score of its own runs): what its runs that started
	 * this day wrote, added up, and how many runs wrote it.
	 */
	metrics?: Record<string, { sum: number; runs: number }>;
};

/**
 * How often a flow's runs needed you over some days, and why. Only its
 * own runs count: a run as a subflow counts in the run that called it.
 */
export type FlowNeededYou = {
	/** Its own runs in the days. */
	runs: number;
	/** Of them, the runs a person stepped in on. */
	needed: number;
	/** Why, the most runs first. */
	reasons: NeededReasonCount[];
};

/**
 * What people answered to "Was this run useful?" about a flow's runs over
 * some days, and what a useful result cost. Only the flow's own runs
 * count: a run as a subflow has no answer of its own.
 */
export type FlowUseful = {
	/** Runs with an answer. */
	answered: number;
	/** Runs whose last answer is yes. */
	useful: number;
	/**
	 * What all its runs in the days cost together, those that did not
	 * finish included, divided by `useful`. Null when no run was useful.
	 */
	costPerUseful: KnownCost | null;
};

/**
 * One score name of a flow's runs over some days, a flow metric (Q32):
 * what its Command, Agent and Value steps wrote, and what became of its
 * pull requests (the optional scorer for code). A Gate's answer and the
 * useful answer are left out: they have their own numbers. Only the flow's
 * own runs count, not its runs as a subflow.
 */
export type FlowScoreRow = {
	name: string;
	/** Runs that scored it at least once. */
	runs: number;
	/** How many values were written. */
	count: number;
	sum: number;
	/** `sum` over `count`. */
	mean: number;
	/** The value written last, when, and in which run. */
	latest: { value: number; at: number; runId: string };
};

/** One run of a flow: a run of its own, or a Subflow run inside another run. */
export type FlowRun = {
	/** The run it is part of. */
	runId: string;
	status: RunStatus;
	startedAt: number;
	/** Null while it has not ended. */
	endedAt: number | null;
	costUsd: number;
	/** The title of the run that called it as a subflow. Null for a run of its own. */
	calledBy: string | null;
	/** Why a run of its own failed or ended. A subflow run has none of its own. */
	reason: string | null;
	/** Part of `costUsd` is estimated from tokens. */
	costEstimated: boolean;
	/** Steps that ended without a cost: their spend is not in `costUsd`. */
	costMissing: number;
	/** Agent sessions and model calls that ended. With none, it could not cost. */
	costCalls: number;
	/** Tokens it used. Null when it did not report any, as a subflow run does not. */
	tokens: number | null;
	/** How many warnings a run of its own has. A subflow run shows its warnings in the run that called it. */
	warnings: number;
};

/** Why runs of a flow did not finish: one reason. */
export type UnfinishedReason = {
	/** The run's own reason. Null when it gave none: then its status says it. */
	reason: string | null;
	status: RunStatus;
	/** The run that called it, when it ran as a subflow. */
	calledBy: string | null;
	runs: number;
	/** When the latest of them started. */
	lastAt: number;
};

/** One warning of a flow's runs, the runs that share it counted once. */
export type FlowWarning = {
	key: string;
	nodeId: string | null;
	message: string;
	runs: number;
	last: { runId: string; at: number };
};

/** One flow over the last `nights` days, today included. */
export type FlowRange = {
	nights: NightRange;
	runs: number;
	asSubflow: number;
	ended: number;
	finished: number;
	unfinished: number;
	/** What a finished run that asked an agent or model cost. */
	cost: Spread | null;
	/**
	 * What a finished run in `cost` used, the same runs. Null when one of
	 * them did not report its tokens.
	 */
	tokenUse: Spread | null;
	/** How long a finished run took. */
	length: Spread | null;
	/** What every run in the days spent, the test runs too. */
	spent: KnownCost;
	/** Tokens of the runs in `spent`. A run that reported none counts as 0. */
	spentTokens: number;
	/**
	 * The test runs in the days (`isTestRun`). Only `spent`, `spentTokens`
	 * and the spend per day count them. Older Hosts send none.
	 */
	tests?: number;
	spentUnfinished: KnownCost;
	/** Tokens of the runs in `spentUnfinished`. */
	unfinishedTokens: number;
	/** The ended run that cost the most. */
	dearest: { costUsd: number; startedAt: number; tokens: number | null } | null;
	warnings: number;
	statuses: StatusCount[];
	/** Runs per day per status, what they spent, how often they needed you and their metrics, oldest first. */
	perNight: FlowDay[];
	/** Every ended run, oldest first: what it cost. */
	endedRuns: {
		runId: string;
		startedAt: number;
		/** The start of the day it started in. */
		night: number;
		costUsd: number;
		/** Tokens it used. Null when it did not report any. */
		tokens: number | null;
		status: RunStatus;
	}[];
	/** The most common first. */
	whyUnfinished: TopRows<UnfinishedReason>;
	/** The most common first. */
	warningRows: TopRows<FlowWarning>;
	/** The most scored first. Empty when no run scored. Older Hosts send none. */
	scores?: FlowScoreRow[];
	/** What people answered to "Was this run useful?". Older Hosts send none. */
	useful?: FlowUseful;
	/** How often its runs needed you, and why. Older Hosts send none. */
	neededYou?: FlowNeededYou;
	/** Where the work of its own runs landed. Older Hosts send none. */
	ladders?: FlowRangeLadders;
	/** The newest first. */
	latest: FlowRun[];
};

/** One flow of a project in detail, behind its Flow health row. */
export type FlowHealthDetail = {
	name: string;
	ranges: FlowRange[];
};
