import { finishedShare, isTestRun } from "../../../run-status";
import { dayStart, lastDays } from "./clock";
import {
	type FlowHealthRow,
	LAST_FLOW_RUNS,
	type LastFlowRun,
	type LatestReport,
} from "./flow-health-types";
import type { NightRange, Spread, TopRows } from "./measure-types";
import type { RunIn } from "./runs";
import { steadinessOf } from "./spend";
import {
	hasEnded,
	reportedTokens,
	spreadOf,
	toLatestReport,
	topRows,
} from "./stats";
import { flowWatch, watchRunsOf } from "./watch";

/** The days a Flow health row covers. */
export const FLOW_HEALTH_DAYS: NightRange = 30;

/** A run of a flow, of its own or as a subflow, and the start of its day. */
type PlacedFlowRun = LastFlowRun & {
	costUsd: number;
	costMissing: number;
	costCalls: number;
	tokens: number | null;
	day: number;
	/** Part of a test run (`isTestRun`): it does not count. */
	test: boolean;
};

/** The runs of the flow `name` in `runs`, on their own and as a subflow. */
function runsOf(
	name: string,
	runs: readonly RunIn[],
	timeZone: string,
): PlacedFlowRun[] {
	return runs.flatMap((run) => [
		...(run.flowName === name
			? [
					{
						runId: run.id,
						status: run.status,
						startedAt: run.createdAt,
						costUsd: run.costUsd,
						costMissing: run.costMissing,
						costCalls: run.costCalls,
						tokens: reportedTokens(run),
						day: dayStart(run.createdAt, timeZone),
						test: isTestRun(run),
					},
				]
			: []),
		...run.subflows
			.filter((subflow) => subflow.flowName === name)
			.map((subflow) => ({
				runId: run.id,
				status: subflow.status,
				startedAt: subflow.startedAt,
				costUsd: subflow.costUsd,
				costMissing: subflow.costMissing,
				costCalls: subflow.costCalls,
				tokens: null,
				day: dayStart(subflow.startedAt, timeZone),
				test: isTestRun(run),
			})),
	]);
}

/**
 * What a finished run costs. A run with a step of unknown cost would look
 * cheaper than it was, so it is left out and counted in `unknown`. A run
 * that asked no agent or model, such as one that found nothing to do, cost
 * nothing for sure. It is left out too, counted in `free`, so it does not
 * drag the cost down.
 */
function finishedCostOf(finished: readonly PlacedFlowRun[]): {
	cost: Spread | null;
	/** The same runs as `cost`. Null when one of them did not report tokens. */
	tokenUse: Spread | null;
	unknown: number;
	free: number;
} {
	const costly = finished.filter((run) => run.costCalls > 0);
	const known = costly.filter((run) => run.costMissing === 0);
	const reported = known.flatMap((run) =>
		run.tokens === null ? [] : [run.tokens],
	);
	return {
		cost: spreadOf(known.map((run) => run.costUsd)),
		tokenUse: reported.length === known.length ? spreadOf(reported) : null,
		unknown: costly.filter((run) => run.costMissing > 0).length,
		free: finished.length - costly.length,
	};
}

/** The runs without the test runs. */
function notTests(runs: readonly PlacedFlowRun[]): PlacedFlowRun[] {
	return runs.filter((run) => !run.test);
}

/**
 * The newest report of the flow's own runs, of any day. A run as a
 * subflow has no report of its own: its End's report went to the run
 * that called it, as `end_report`. A test run's report is a try, not a
 * result: it does not count.
 */
function reportOf(name: string, runs: readonly RunIn[]): LatestReport | null {
	let newest: LatestReport | null = null;
	for (const run of runs) {
		if (run.flowName !== name || isTestRun(run)) continue;
		const report = toLatestReport(run);
		if (report && (newest === null || report.endedAt > newest.endedAt)) {
			newest = report;
		}
	}
	return newest;
}

/**
 * Each flow over the last `days` days: its last runs, its newest report,
 * how often it finished, what a finished run costs, how steady it is, and
 * the watch over it. A stopped run did not finish, so it counts against
 * it. A flow a Subflow node ran counts too, inside the run that called it.
 * A test run does not count at all. The busiest flows first, then the one
 * that ran last.
 */
export function flowHealthRows(
	flows: readonly string[],
	runs: readonly RunIn[],
	now: number,
	timeZone: string,
	days: NightRange = FLOW_HEALTH_DAYS,
): TopRows<FlowHealthRow> {
	const first = lastDays(days, now, timeZone)[0] ?? 0;
	const rows = flows.map((name): FlowHealthRow => {
		const mine = notTests(runsOf(name, runs, timeZone));
		const lastRuns = [...mine]
			.sort((a, b) => b.startedAt - a.startedAt)
			.slice(0, LAST_FLOW_RUNS)
			.map(
				(run): LastFlowRun => ({
					runId: run.runId,
					status: run.status,
					startedAt: run.startedAt,
				}),
			);
		const report = reportOf(name, runs);
		const recent = mine.filter((run) => run.day >= first);
		const ended = recent.filter(hasEnded);
		const finished = ended.filter((run) => run.status === "finished");
		// A run that failed early spent next to nothing, which would drag down
		// what a run costs. Its spend shows on its own instead.
		const unfinished = ended.filter((run) => run.status !== "finished");
		const { cost, tokenUse, unknown, free } = finishedCostOf(finished);
		const watch = flowWatch(watchRunsOf(name, runs, now), now, first);
		return {
			name,
			last: lastRuns[0] ?? null,
			lastRuns,
			runs: recent.length,
			rate: finishedShare(finished.length, ended.length),
			cost,
			tokenUse,
			unknownCost: unknown,
			freeRuns: free,
			unfinished: {
				count: unfinished.length,
				costUsd: unfinished.reduce((total, run) => total + run.costUsd, 0),
				tokens: unfinished.reduce((total, run) => total + (run.tokens ?? 0), 0),
			},
			...(report ? { report } : {}),
			watch,
			steady: { cost: steadinessOf(cost), time: steadinessOf(watch.length) },
		};
	});
	return topRows(
		rows.sort(
			(a, b) =>
				b.runs - a.runs || (b.last?.startedAt ?? 0) - (a.last?.startedAt ?? 0),
		),
	);
}
