import type { HelpAgent } from "../assistant";
import type { RungBy } from "../log";
import {
	type Ladder,
	type NeededYouReason,
	NIGHT_RANGES,
	type NightRange,
	type Rung,
	type RunSummary,
} from "../read";
import type { RunResult, RunStatus } from "../run-status";

/**
 * The dashboard's numbers, computed from the runs on the server: the stat
 * cards and their details, what the latest day produced, what comes next,
 * and the health of each flow. Each range a toggle offers is computed, so
 * a toggle needs no new request.
 *
 * A day runs from midnight to midnight on the reader's clock. The wire
 * keys still say night (`nights`, `perNight`, `night`, `lastNight`,
 * `healthNights`, `nightsWithRuns`), and so do the types named after
 * them: other phone and Host builds read those keys.
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

/** One hour of the stat cards' small charts, the last 24 hours. */
export type CardHour = {
	hour: number;
	/** Runs at work in this hour. */
	active: number;
	/** Gates that waited in this hour, answered ones too. */
	gates: number;
	/** What the runs that started in this hour spent. */
	costUsd: number;
	/** Tokens the runs that started in this hour used. */
	tokens: number;
	/** Of the runs that started in this hour: how they stand. */
	finished: number;
	failed: number;
	other: number;
};

/** The runs started in one 24-hour period. */
export type DayCounts = {
	runs: number;
	finished: number;
	failed: number;
	cost: KnownCost;
	/** Tokens the runs used. */
	tokens: number;
};

/** The numbers on top of the dashboard. */
export type DashboardCards = {
	running: number;
	sleeping: number;
	/** When the sleeping run that wakes first wakes. */
	nextWakeAt: number | null;
	/** The runs started in the last 24 hours. */
	lastDay: DayCounts & {
		/** When the newest of them started. */
		latestAt: number | null;
	};
	/** The runs started in the 24 hours before the last day, to compare with. */
	dayBefore: DayCounts;
	/**
	 * This time yesterday, to compare with what runs and waits now. A run
	 * counts while it is at work, also when it waits or sleeps.
	 */
	yesterday: { running: number; gates: number };
	allTime: KnownCost;
	/** The last 24 hours, oldest first. */
	hours: CardHour[];
};

/** How long the runs of one flow or project were at work in a range. */
export type AtWorkGroup = {
	label: string;
	/** Runs at work at some point in the range. */
	runs: number;
	started: number;
	/** The time its runs were at work in the range, added up. */
	atWork: number;
	longest: number;
};

/** What was at work over the last `hours` hours. */
export type ActivityRange = {
	hours: HourRange;
	/** Runs at work in each hour, oldest first. */
	perHour: { hour: number; active: number }[];
	/** The most runs at work in one hour. */
	peak: number;
	/** Hours with a run at work. */
	busy: number;
	/** Runs started in the range. */
	started: number;
	/** The most time at work first. */
	groups: TopRows<AtWorkGroup>;
};

/** One spend group: a flow or a project, or the rest together. */
export type SpendGroup = {
	/** A key for the chart: `g0` to `g3`, or `other` for the rest. */
	key: string;
	label: string;
	runs: number;
	total: number;
	/** What its runs that ended without finishing spent: part of `total`. */
	unfinished: number;
	/** Tokens its runs used. */
	tokens: number;
	/** Tokens of the runs in `unfinished`. */
	unfinishedTokens: number;
};

export type SpendRange = {
	/** Spend in the range. */
	total: number;
	/** Tokens the runs in the range used. */
	tokens: number;
	/** Runs started in the range. */
	runs: number;
	/** The days in the range with a run. */
	nightsWithRuns: number;
	/** Runs with a step that did not report its cost. */
	unknown: number;
	/** The groups ranked by spend: the top four, then the rest as one. */
	groups: SpendGroup[];
	/** Spend per day per group key, oldest first. */
	perNight: NightCounts[];
	/** Tokens per day per group key, the same days and keys as `perNight`. */
	tokensPerNight: NightCounts[];
	/** The runs that cost the most, the dearest first. */
	priciest: DashboardRun[];
};

/** A failed run, and how its flow or project did after it. */
export type FailedRun = DashboardRun & {
	/** The later runs of the same flow or project, in the range. */
	after: {
		runs: number;
		finished: number;
		/** The newest of them. Null when none started. */
		last: { status: RunStatus; createdAt: number } | null;
	};
};

/**
 * The failures of one flow in a range: one row per flow, not per run, so
 * a flow that fails each day shows once.
 */
export type FailingFlow = {
	/** The project and the flow: `<projectId>/<flow>`. */
	key: string;
	/** Its flow, or its project over all projects. */
	group: string;
	/** The flow name, or the prompt of a quick run. */
	title: string;
	/** The newest failed run. */
	runId: string;
	/** When the newest failed run started. */
	lastAt: number;
	/** Why the newest failed run failed. */
	reason: string | null;
	/** Its failed runs in the range. */
	failed: number;
	/** When a later run of the flow finished. Null while it still fails. */
	fixedAt: number | null;
};

/** How the runs of one flow or project went in a range. */
export type RunsGroup = {
	label: string;
	runs: number;
	finished: number;
	failed: number;
};

export type RunsRange = {
	/** Runs started in the range. */
	runs: number;
	/** Of them, the ones that finished or failed. */
	ended: number;
	finished: number;
	/** The days in the range with a run. */
	nightsWithRuns: number;
	/** How many runs have each status: live first, without the empty ones. */
	statuses: StatusCount[];
	/** Runs per day per status, oldest first. */
	perNight: NightCounts[];
	/** The most runs first. */
	groups: TopRows<RunsGroup>;
	/** The failed runs, newest first. */
	failed: TopRows<FailedRun>;
	/** The flows with failed runs: the ones that still fail first, then the newest. */
	failing: TopRows<FailingFlow>;
	/** Of them, the flows no later run finished. */
	stillFailing: number;
};

/** How an asked Gate stands. */
export type GateState = "answered" | "unanswered" | "waiting";

/** One Gate a run asked. */
export type AskedGate = {
	key: string;
	runId: string;
	runTitle: string;
	/** Its flow, or its project over all projects. */
	group: string;
	openedAt: number;
	state: GateState;
	/** How long it waited, until now while it waits. Null when not known. */
	wait: number | null;
};

/** The Gates the runs of one flow or project asked in a range. */
export type GatesGroup = {
	label: string;
	asked: number;
	answered: number;
	unanswered: number;
	/** The Gates that wait for an answer now. */
	waiting: number;
	/** The runs that asked them. */
	runs: number;
	/** When the newest of them opened. */
	lastAskedAt: number;
	/** The median wait of the answered Gates. */
	typical: number | null;
	/** The longest wait, the open Gates too. */
	longest: number | null;
};

export type GatesRange = {
	asked: number;
	/** The runs that asked them. */
	runsAsking: number;
	answered: number;
	unanswered: number;
	/** How long the answered Gates waited. */
	answerTime: Spread | null;
	/** The states that occur, in the order the chart stacks them. */
	states: GateState[];
	/** Gates asked per day per state, oldest first. */
	perNight: NightCounts[];
	/** The most asked first. */
	groups: TopRows<GatesGroup>;
	/** The newest first. */
	latest: AskedGate[];
};

/** Why runs needed you: one reason, and how many runs had it. */
export type NeededReasonCount = { reason: NeededYouReason; runs: number };

/** A run that needed you, in a list. */
export type NeededRun = {
	runId: string;
	runTitle: string;
	/** Its flow, or its project over all projects. */
	group: string;
	createdAt: number;
	/** Why: each reason once, in the order they first happened. */
	reasons: NeededYouReason[];
};

/** The runs of one flow or project that needed you in a range. */
export type NeededGroup = {
	label: string;
	/** Runs started in the range. */
	runs: number;
	/** Of them, the runs a person stepped in on. */
	needed: number;
	/** Why, the most runs first. */
	reasons: NeededReasonCount[];
};

/**
 * How often the runs started in a range needed you, and why: a person
 * answered a Gate or an Ask, resumed, stopped, or took a run over.
 */
export type NeededRange = {
	/** Runs started in the range. */
	runs: number;
	/** Of them, the runs a person stepped in on. */
	needed: number;
	/** Why, the most runs first. A run with two reasons counts under both. */
	reasons: NeededReasonCount[];
	/** Per day: the runs that needed you (`needed`) and the runs that did not (`alone`), oldest first. */
	perNight: NightCounts[];
	/** The groups with a run that needed you, the most first. */
	groups: TopRows<NeededGroup>;
	/** The newest runs that needed you first. */
	latest: NeededRun[];
};

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

/** The newest report of one flow in a range: one row per flow. */
export type FlowReport = LatestReport & {
	/** The project and the flow: `<projectId>/<flow>`. */
	key: string;
	/** Its flow, or its project over all projects. */
	group: string;
	/** The flow name, or the prompt of a quick run. */
	title: string;
};

/**
 * The headline numbers of one day: runs, how they ended, spend, Gates,
 * Needed you. A test run counts only in the spend (`costUsd`, `tokens`).
 */
export type NightTotals = {
	/** The start of the day. */
	night: number;
	runs: number;
	/** Runs that finished or failed. */
	ended: number;
	finished: number;
	/** What the runs spent, the steps with a known cost, the test runs too. */
	costUsd: number;
	/** Tokens the runs used, the test runs too. */
	tokens: number;
	/** Gates the runs asked. */
	gates: number;
	/**
	 * The runs that started this day and needed you: a person answered a
	 * Gate or an Ask, resumed, stopped, or took one over. Older Hosts send
	 * none.
	 */
	neededYou?: number;
};

/** The headline numbers of a period, and per day, oldest first. */
export type PeriodTotals = Omit<NightTotals, "night"> & {
	perNight: NightTotals[];
};

/**
 * The details over the last `nights` days, today included. A test run
 * (`isTestRun`) counts in `spend` and in the spend of the totals only:
 * runs, Gates, Needed you, the reports and Flow health leave it out.
 */
export type NightsRange = {
	/** How many days. */
	nights: NightRange;
	spend: SpendRange;
	runs: RunsRange;
	gates: GatesRange;
	/** How often the runs needed you, and why. Older Hosts send none. */
	needed?: NeededRange;
	/**
	 * The newest report of each flow whose own runs started in these days
	 * wrote one, the newest end first. Older Hosts send none.
	 */
	reports?: TopRows<FlowReport>;
	/** The headline numbers over these days. */
	totals: PeriodTotals;
	/**
	 * The same numbers over as many days just before: what every number
	 * compares with.
	 */
	before: PeriodTotals;
	/** Flow health over these days, on a project's dashboard. */
	flows: TopRows<FlowHealthRow> | null;
};

/**
 * What the latest day with a real run produced (a test run is not one).
 * Without any real run, the latest day with runs.
 */
export type NightOutput = {
	/** The start of the day: its midnight on the reader's clock. */
	night: number;
	/** Its runs, the test runs among them. */
	runs: number;
	/** Its spend: the test runs count in it. */
	cost: KnownCost;
	/** Tokens its runs used, the test runs too. */
	tokens: number;
	/**
	 * Of `runs`, the test runs (`isTestRun`): every count but the spend
	 * leaves them out. Absent: none, or an older Host.
	 */
	tests?: number;
	/**
	 * Its newest runs, whole, so they show like any run list. `group` is its
	 * flow or its project, as on a DashboardRun.
	 */
	latest: (RunSummary & { group: string })[];
};

/** A run's next moment on its own: a wake-up or a stop time. */
export type UpcomingRun = {
	kind: "wake" | "stop";
	at: number;
	runId: string;
	title: string;
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

/** The dashboard of a Space, or of one project in it. */
export type DashboardSummary = {
	/** When it was computed. */
	at: number;
	cards: DashboardCards;
	/** The newest runs. */
	recent: RunSummary[];
	/**
	 * The runs at work, waiting or asleep: the oldest first. `running`
	 * counts the runs on their way, at work or asleep, as Running now
	 * does: not the ones at a Gate.
	 */
	open: TopRows<DashboardRun> & { running: number; nextWakeAt: number | null };
	activity: ActivityRange[];
	/** The details per day range. */
	nights: NightsRange[];
	/**
	 * The days Flow health covers (`flowHealth`). It is one of the ranges
	 * of `nights`: a screen that shows how the projects did over the same
	 * window picks that range.
	 */
	healthNights: NightRange;
	/** The latest day with a real run (`NightOutput`). Null without runs. */
	lastNight: NightOutput | null;
	/** The soonest wake-ups and stop times. */
	upNext: UpcomingRun[];
	/** The busiest flows of a project. Null over all projects. */
	flowHealth: TopRows<FlowHealthRow> | null;
	/** The watch over every flow of the dashboard. Older Hosts send none. */
	watch?: SpaceWatch;
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

/**
 * How steady the cost of a flow's runs is. `steady`: the middle half of
 * its runs stay within 20% of a usual run, and no run costs over twice
 * that. `unsteady`: a quarter of its runs cost over twice a usual run, or
 * one costs over four times that. `varies`: between the two.
 */
export const COST_STEADINESS = ["steady", "varies", "unsteady"] as const;
export type CostSteadiness = (typeof COST_STEADINESS)[number];

/** One step of a flow on the Spend page: what its node costs in a usual run. */
export type SpendStep = {
	/** `<via>/<nodeId>`. */
	key: string;
	nodeId: string;
	/** The Subflow nodes it ran in, outermost first, joined by `/`. Absent at the top level. */
	via?: string;
	/** What it cost per run on average, every try included. */
	perRun: number;
	/** The most it cost in one run. */
	most: number;
	/** How often its work landed per run on average: over 1, it worked again. */
	timesPerRun: number;
};

/**
 * A way to save, read from the runs. `unfinished`: runs that ended
 * without finishing, and what they spent. `nothing`: finished runs that
 * found nothing to do, and what they spent. `costly`: finished runs that
 * cost over twice a usual run, and what they cost above one.
 */
export const SAVING_KINDS = ["unfinished", "nothing", "costly"] as const;
export type SavingKind = (typeof SAVING_KINDS)[number];

/** One way to save on one flow over some days. A run counts under one kind only. */
export type SpendSaving = {
	/** `<projectId>/<flow>/<kind>`. */
	key: string;
	kind: SavingKind;
	projectId: string;
	flow: string;
	/** What the runs that show it spent that a change saves. */
	saves: number;
	/** The runs that show it. */
	runs: number;
	/** The flow's own real runs in the days. */
	of: number;
	/** The newest run that shows it. */
	runId: string;
	/** `costly`: the step that cost the most above what it usually costs. */
	step?: { nodeId: string; via?: string };
};

/** One flow on the Spend page over some days. */
export type SpendFlow = {
	/** The project and the flow: `<projectId>/<flow>`. */
	key: string;
	projectId: string;
	flow: string;
	/** Its own runs that started in the days, the test runs too. */
	runs: number;
	/** What they spent. */
	spent: number;
	/** What a finished run with a known cost cost. A test run is not in it. Null without one. */
	usual: Spread | null;
	/** Null with too few runs in `usual`. */
	steadiness: CostSteadiness | null;
	/** What its ways to save add up to. */
	saves: number;
	/** The steps that cost the most per run first, over the runs of `usual`. */
	steps: SpendStep[];
};

/** One day of the Spend page. `night` is the start of the day. */
export type SpendDay = {
	night: number;
	/** What the runs that started this day spent. */
	costUsd: number;
	/** The part of it a way to save covers. */
	saves: number;
};

/**
 * What Night Shift's own agents cost for their answers: the Builder and
 * the Improver in a chat, the Explainer on a run, the Field writer on a
 * field. Not part of a run's cost, and not in the spend of the runs.
 */
export type HelpSpend = {
	/** What the answers with a known cost cost. */
	total: number;
	/** The answers. */
	answers: number;
	/** Of them, the answers whose cost is not known. */
	unknown: number;
	/** One per agent that answered, the most cost first. */
	agents: { agent: HelpAgent; answers: number; costUsd: number }[];
};

/** The Spend page over the last `nights` days, today included. */
export type SpendDays = {
	nights: NightRange;
	/** What every run that started in the days spent, the test runs too. */
	total: number;
	/** The same over as many days just before. */
	before: number;
	/** Runs that started in the days. */
	runs: number;
	/** Of them, the runs with a step that did not report its cost. */
	unknown: number;
	/** Oldest first. */
	perNight: SpendDay[];
	/** The flows with a run in the days, the most spend first. */
	flows: SpendFlow[];
	/** The quick runs: they have no flow. */
	quick: { runs: number; spent: number };
	/** The most saved first. */
	savings: SpendSaving[];
	/** What the ways to save add up to. */
	saves: number;
	/** What Night Shift's own agents cost in the days. Not in `total`. */
	help: HelpSpend;
};

/** What the runs of a Space cost, how steady that is, and where a change saves. */
export type SpaceSpend = {
	/** When it was computed. */
	at: number;
	/** One per day range. */
	ranges: SpendDays[];
	/**
	 * What Night Shift's own agents cost in the calendar month of `at`, on
	 * the reader's clock, up to now.
	 */
	helpThisMonth: number;
};

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
