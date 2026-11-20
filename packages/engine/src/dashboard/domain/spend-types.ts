import type { HelpAgent } from "../../assistant";
import type { NightRange, Spread } from "./measure-types";

/** The Spend page: what the runs of a Space cost, how steady that is, and where a change saves. */

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
