import type { NeededYouReason, RunSummary } from "../read";
import type { RunStatus } from "../run-status";
import type {
	FlowHealthRow,
	LatestReport,
	NeededReasonCount,
	SpaceWatch,
} from "./flow-health-types";
import type {
	DashboardRun,
	HourRange,
	KnownCost,
	NightCounts,
	NightRange,
	Spread,
	StatusCount,
	TopRows,
} from "./measure-types";

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
