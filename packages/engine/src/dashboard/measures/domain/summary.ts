import { dayStart, lastDays } from "./clock";
import { FLOW_HEALTH_DAYS, flowHealthRows } from "./flow-health";
import { NIGHT_RANGES, OVERVIEW_ROWS } from "./measure-types";
import { notTests, type PlacedRun, reportsOf } from "./nights";
import type { RunIn } from "./runs";
import type { DashboardSummaryOf, NightOutput } from "./summary-types";
import { spaceWatch } from "./watch";

/**
 * What the dashboard covers: one project, whose runs group by flow, or
 * every project, whose runs group by project.
 */
export type DashboardScope =
	| {
			kind: "project";
			/** The project's flows, for Flow health. */
			flows: readonly string[];
	  }
	| {
			kind: "all";
			/** Each project's name by its id. A run of a project not in it is of a removed one. */
			projectNames: ReadonlyMap<string, string>;
	  };

export type DashboardOptions = {
	now: number;
	/** The reader's time zone (IANA): where a day's midnight falls. */
	timeZone: string;
	scope: DashboardScope;
};

/** The group a run counts in: its flow in a project, its project over all of them. */
function groupOf(scope: DashboardScope): (run: RunIn) => string {
	return scope.kind === "project"
		? (run) => run.flowName ?? "Quick runs"
		: (run) => scope.projectNames.get(run.projectId) ?? "Removed";
}

/**
 * The latest day with a real run, its newest runs first, its test runs
 * among them. A day of only test runs was a try, not a day of work: the
 * day before it shows. Without any real run, the latest day with runs, so
 * the test runs still show.
 */
function lastDayOf<Run extends RunIn>(
	runs: readonly PlacedRun<Run>[],
): NightOutput<Run> | null {
	const newest = newestOf(notTests(runs)) ?? newestOf(runs);
	if (!newest) return null;
	const ofDay = runs
		.filter(({ day }) => day === newest.day)
		.sort((a, b) => b.run.createdAt - a.run.createdAt);
	return {
		latest: ofDay
			.slice(0, OVERVIEW_ROWS)
			.map(({ run, group }) => ({ ...run, group })),
	};
}

/** The run that started last. */
function newestOf<Run extends RunIn>(
	runs: readonly PlacedRun<Run>[],
): PlacedRun<Run> | undefined {
	return runs.reduce<PlacedRun<Run> | undefined>(
		(latest, placed) =>
			latest === undefined || placed.run.createdAt > latest.run.createdAt
				? placed
				: latest,
		undefined,
	);
}

/**
 * The dashboard of `runs`: the latest reports of every range a toggle
 * offers, the runs of the latest day, the watch over the flows, and (for
 * one project) the health of its flows. A test run shows in the latest
 * day. The reports, Flow health and the watch leave it out (`isTestRun`).
 */
export function summarizeDashboard<Run extends RunIn>(
	runs: readonly Run[],
	options: DashboardOptions,
): DashboardSummaryOf<Run> {
	const { now, timeZone, scope } = options;
	const group = groupOf(scope);
	const placed: PlacedRun<Run>[] = runs.map((run) => ({
		run,
		day: dayStart(run.createdAt, timeZone),
		group: group(run),
	}));
	return {
		nights: NIGHT_RANGES.map((range) => ({
			nights: range,
			reports: reportsOf(range, placed, now, timeZone),
			flows:
				scope.kind === "project"
					? flowHealthRows(scope.flows, runs, now, timeZone, range)
					: null,
		})),
		lastNight: lastDayOf(placed),
		flowHealth:
			scope.kind === "project"
				? flowHealthRows(scope.flows, runs, now, timeZone)
				: null,
		watch: spaceWatch(
			runs,
			now,
			lastDays(FLOW_HEALTH_DAYS, now, timeZone)[0] ?? 0,
		),
	};
}
