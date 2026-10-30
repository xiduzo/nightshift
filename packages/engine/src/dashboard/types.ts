import type { RunStatus } from "../log";
import type { RunSummary } from "../read";

/**
 * The dashboard's numbers, computed from the runs on the server: the stat
 * cards and their details, what the night produced, what comes next, and
 * the health of each flow. Each range a toggle offers is computed, so a
 * toggle needs no new request.
 */

/** The night ranges the details offer: 7, 30 or 90 nights. */
export const NIGHT_RANGES = [7, 30, 90] as const;
export type NightRange = (typeof NIGHT_RANGES)[number];

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
	/** Its flow (on a project's dashboard), or its project (over all of them). */
	group: string;
};

/** The first rows of a ranked list, and how many rows it has in all. */
export type TopRows<T> = { rows: T[]; count: number };

/** How many runs have one status. */
export type StatusCount = { status: RunStatus; count: number };

/** One night and a count per key: a status, a Gate state, a spend group. */
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
};

export type SpendRange = {
	/** Spend in the range. */
	total: number;
	/** Runs started in the range. */
	runs: number;
	nightsWithRuns: number;
	/** Runs with a step that did not report its cost. */
	unknown: number;
	/** The groups ranked by spend: the top four, then the rest as one. */
	groups: SpendGroup[];
	/** Spend per night per group key, oldest first. */
	perNight: NightCounts[];
	/** The runs that cost the most, the dearest first. */
	priciest: DashboardRun[];
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
	nightsWithRuns: number;
	/** How many runs have each status: live first, without the empty ones. */
	statuses: StatusCount[];
	/** Runs per night per status, oldest first. */
	perNight: NightCounts[];
	/** The most runs first. */
	groups: TopRows<RunsGroup>;
	/** The failed runs, newest first. */
	failed: TopRows<DashboardRun>;
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
	/** Gates asked per night per state, oldest first. */
	perNight: NightCounts[];
	/** The most asked first. */
	groups: TopRows<GatesGroup>;
	/** The newest first. */
	latest: AskedGate[];
};

/** The headline numbers of one night: runs, how they ended, spend, Gates. */
export type NightTotals = {
	night: number;
	runs: number;
	/** Runs that finished or failed. */
	ended: number;
	finished: number;
	/** What the runs spent, the steps with a known cost. */
	costUsd: number;
	/** Gates the runs asked. */
	gates: number;
};

/** The headline numbers of a period, and per night, oldest first. */
export type PeriodTotals = Omit<NightTotals, "night"> & {
	perNight: NightTotals[];
};

/** The details over the last `nights` nights. */
export type NightsRange = {
	nights: NightRange;
	spend: SpendRange;
	runs: RunsRange;
	gates: GatesRange;
	/** The headline numbers over these nights. */
	totals: PeriodTotals;
	/**
	 * The same numbers over as many nights just before: what every number
	 * compares with.
	 */
	before: PeriodTotals;
	/** Flow health over these nights, on a project's dashboard. */
	flows: TopRows<FlowHealthRow> | null;
};

/** What the latest night with runs produced. */
export type NightOutput = {
	/** The noon the night starts. */
	night: number;
	runs: number;
	cost: KnownCost;
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

/** One row of Flow health: a flow over the last nights. */
export type FlowHealthRow = {
	name: string;
	last: LastFlowRun | null;
	/** Its last runs, at most {@link LAST_FLOW_RUNS}, newest first, of any night. */
	lastRuns: LastFlowRun[];
	/** Runs in the last nights, on its own and as a subflow. */
	runs: number;
	finished: number;
	ended: number;
	/** Percent of ended runs that finished. Null when none ended. */
	rate: number | null;
	/** What a finished run that asked an agent or model cost. Null when none did. */
	cost: Spread | null;
	/** The runs that ended without finishing, and what they spent together. */
	unfinished: { count: number; costUsd: number };
	/** Finished runs with a step whose cost is not known: not in `cost`. */
	unknownCost: number;
	/** Finished runs that asked no agent or model: not in `cost`. */
	freeRuns: number;
};

/** The dashboard of a Space, or of one project in it. */
export type DashboardSummary = {
	/** When it was computed. */
	at: number;
	cards: DashboardCards;
	/** The newest runs. */
	recent: RunSummary[];
	/** The runs at work, waiting or asleep: the oldest first. */
	open: TopRows<DashboardRun> & { running: number; nextWakeAt: number | null };
	activity: ActivityRange[];
	nights: NightsRange[];
	/**
	 * The nights Flow health covers (`flowHealth`). It is one of the ranges
	 * of `nights`: a screen that shows how the projects did over the same
	 * window picks that range.
	 */
	healthNights: NightRange;
	/** Null without runs. */
	lastNight: NightOutput | null;
	/** The soonest wake-ups and stop times. */
	upNext: UpcomingRun[];
	/** The busiest flows of a project. Null over all projects. */
	flowHealth: TopRows<FlowHealthRow> | null;
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

/** One flow over the last `nights` nights. */
export type FlowRange = {
	nights: NightRange;
	runs: number;
	asSubflow: number;
	ended: number;
	finished: number;
	unfinished: number;
	/** What a finished run that asked an agent or model cost. */
	cost: Spread | null;
	/** How long a finished run took. */
	length: Spread | null;
	spent: KnownCost;
	spentUnfinished: KnownCost;
	/** The ended run that cost the most. */
	dearest: { costUsd: number; startedAt: number } | null;
	warnings: number;
	statuses: StatusCount[];
	/** Runs per night per status, oldest first. */
	perNight: NightCounts[];
	/** Every ended run, oldest first: what it cost. */
	endedRuns: {
		runId: string;
		startedAt: number;
		/** The night it started in. */
		night: number;
		costUsd: number;
		status: RunStatus;
	}[];
	/** The most common first. */
	whyUnfinished: TopRows<UnfinishedReason>;
	/** The most common first. */
	warningRows: TopRows<FlowWarning>;
	/** The newest first. */
	latest: FlowRun[];
};

/** One flow of a project in detail, behind its Flow health row. */
export type FlowHealthDetail = {
	name: string;
	ranges: FlowRange[];
};
