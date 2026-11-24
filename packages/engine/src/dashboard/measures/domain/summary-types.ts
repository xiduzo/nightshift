import type {
	FlowHealthRow,
	LatestReport,
	SpaceWatch,
} from "./flow-health-types";
import type { NightRange, TopRows } from "./measure-types";
import type { RunIn } from "./runs";

/**
 * The dashboard's numbers, computed from the runs on the server. Each
 * range a toggle offers is computed, so a toggle needs no new request. A
 * day runs from midnight to midnight on the reader's clock. The keys say
 * night (`nights`, `lastNight`) for days.
 */

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
 * The details over the last `nights` days, today included. A test run
 * (`isTestRun`) is in none of them.
 */
export type NightsRange = {
	/** How many days. */
	nights: NightRange;
	/**
	 * The newest report of each flow whose own runs started in these days
	 * wrote one, the newest end first.
	 */
	reports: TopRows<FlowReport>;
	/** Flow health over these days, on a project's dashboard. */
	flows: TopRows<FlowHealthRow> | null;
};

/**
 * What the latest day with a real run produced (a test run is not one).
 * Without any real run, the latest day with runs.
 */
export type NightOutput<Run extends RunIn = RunIn> = {
	/**
	 * Its newest runs, whole, so they show like any run list. `group` is its
	 * flow or its project.
	 */
	latest: (Run & { group: string })[];
};

/** The dashboard of a Space, or of one project in it. */
export type DashboardSummaryOf<Run extends RunIn> = {
	/** The details per day range. */
	nights: NightsRange[];
	/** The latest day with a real run (`NightOutput`). Null without runs. */
	lastNight: NightOutput<Run> | null;
	/** The busiest flows of a project. Null over all projects. */
	flowHealth: TopRows<FlowHealthRow> | null;
	/** The watch over every flow of the dashboard. */
	watch: SpaceWatch;
};
