import type { RunScore } from "../log";
import type { NeededYouReason, RunSummary } from "../read";
import { finishedShare, usefulAnswer } from "../run-status";
import { dayStart, lastDays } from "./clock";
import { countReasons, neededReasons } from "./needed";
import {
	countStatuses,
	hasEnded,
	reportedTokens,
	spreadOf,
	sumKnownCost,
	topRows,
} from "./stats";
import {
	type FlowHealthDetail,
	type FlowHealthRow,
	type FlowNeededYou,
	type FlowRange,
	type FlowRun,
	type FlowScoreRow,
	type FlowUseful,
	type FlowWarning,
	LAST_FLOW_RUNS,
	type LastFlowRun,
	NIGHT_RANGES,
	type NightCounts,
	type NightRange,
	OVERVIEW_ROWS,
	type Spread,
	type TopRows,
	type UnfinishedReason,
} from "./types";

/** The days a Flow health row covers. */
export const FLOW_HEALTH_DAYS: NightRange = 30;

/** A run of a flow with its warnings, its scores, why it needed you and the start of the day it started in. */
type PlacedFlowRun = Omit<FlowRun, "warnings"> & {
	warnings: RunSummary["warnings"];
	/** Its scores. A subflow run has none: they are in the run that called it. */
	scores: RunScore[];
	/** Why it needed you. A subflow run has none: they are in the run that called it. */
	needed: NeededYouReason[];
	day: number;
};

/** The runs of the flow `name` in `runs`, on their own and as a subflow. */
function runsOf(
	name: string,
	runs: readonly RunSummary[],
	timeZone: string,
): PlacedFlowRun[] {
	return runs.flatMap((run) => [
		...(run.flowName === name
			? [
					{
						runId: run.id,
						status: run.status,
						startedAt: run.createdAt,
						endedAt: run.endedAt,
						costUsd: run.costUsd,
						costEstimated: run.costEstimated,
						costMissing: run.costMissing,
						costCalls: run.costCalls,
						tokens: reportedTokens(run),
						calledBy: null,
						reason: run.reason,
						warnings: run.warnings,
						scores: run.metrics?.scores ?? [],
						needed: neededReasons(run),
						day: dayStart(run.createdAt, timeZone),
					},
				]
			: []),
		...run.subflows
			.filter((subflow) => subflow.flowName === name)
			.map((subflow) => ({
				runId: run.id,
				status: subflow.status,
				startedAt: subflow.startedAt,
				endedAt: subflow.endedAt,
				costUsd: subflow.costUsd,
				costEstimated: subflow.costEstimated,
				costMissing: subflow.costMissing,
				costCalls: subflow.costCalls,
				tokens: null,
				calledBy: run.title,
				reason: null,
				warnings: [],
				scores: [],
				needed: [],
				day: dayStart(subflow.startedAt, timeZone),
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

function toFlowRun({
	day: _day,
	scores: _scores,
	needed: _needed,
	...run
}: PlacedFlowRun): FlowRun {
	return { ...run, warnings: run.warnings.length };
}

/**
 * Scores with numbers of their own: left out of the score rows. A run
 * score names the useful answer `useful`. `pr_useful` is its older name.
 */
const NOT_IN_SCORE_ROWS: ReadonlySet<string> = new Set([
	"gate_decision",
	"useful",
	"pr_useful",
]);

/**
 * The scores of the runs, one row per name, the most scored first. A
 * Gate's answer and the useful answer are left out: they have their own
 * numbers.
 */
function scoresOf(runs: readonly PlacedFlowRun[]): FlowScoreRow[] {
	const byName = new Map<string, FlowScoreRow & { runIds: Set<string> }>();
	for (const run of runs) {
		for (const { score, value, at } of run.scores) {
			if (NOT_IN_SCORE_ROWS.has(score)) continue;
			const row = byName.get(score) ?? {
				name: score,
				runs: 0,
				count: 0,
				sum: 0,
				mean: 0,
				latest: { value, at, runId: run.runId },
				runIds: new Set<string>(),
			};
			row.runIds.add(run.runId);
			row.runs = row.runIds.size;
			row.count += 1;
			row.sum += value;
			row.mean = row.sum / row.count;
			if (at >= row.latest.at) row.latest = { value, at, runId: run.runId };
			byName.set(score, row);
		}
	}
	return [...byName.values()]
		.sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name))
		.map(({ runIds: _runIds, ...row }) => row);
}

/**
 * What people answered to "Was this run useful?" about the flow's own
 * runs, and what a useful result cost: what all of them cost together,
 * those that did not finish included, divided by the useful ones. A run as
 * a subflow has no answer of its own, and its cost is in its caller's.
 */
function usefulOf(runs: readonly PlacedFlowRun[]): FlowUseful {
	const own = runs.filter((run) => run.calledBy === null);
	const answers = own.map((run) => usefulAnswer(run.scores));
	const answered = answers.filter((answer) => answer !== null).length;
	const useful = answers.filter((answer) => answer === true).length;
	const spent = sumKnownCost(own);
	return {
		answered,
		useful,
		costPerUseful:
			useful > 0 ? { ...spent, costUsd: spent.costUsd / useful } : null,
	};
}

/**
 * How often the flow's own runs needed you, and why. A run as a subflow
 * counts in the run that called it.
 */
function neededYouOf(runs: readonly PlacedFlowRun[]): FlowNeededYou {
	const own = runs.filter((run) => run.calledBy === null);
	const needed = own.filter((run) => run.needed.length > 0);
	return {
		runs: own.length,
		needed: needed.length,
		reasons: countReasons(needed.map((run) => run.needed)),
	};
}

/**
 * Each flow over the last `days` days: its last runs, how often it
 * finished, what a finished run costs, what a useful result costs, and
 * how often its runs needed you. A
 * stopped run did not finish, so it counts against it. A flow a Subflow
 * node ran counts too, inside the run that called it. The busiest flows
 * first, then the one that ran last.
 */
export function flowHealthRows(
	flows: readonly string[],
	runs: readonly RunSummary[],
	now: number,
	timeZone: string,
	days: NightRange = FLOW_HEALTH_DAYS,
): TopRows<FlowHealthRow> {
	const first = lastDays(days, now, timeZone)[0] ?? 0;
	const rows = flows.map((name): FlowHealthRow => {
		const mine = runsOf(name, runs, timeZone);
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
		const recent = mine.filter((run) => run.day >= first);
		const ended = recent.filter(hasEnded);
		const finished = ended.filter((run) => run.status === "finished");
		// A run that failed early spent next to nothing, which would drag down
		// what a run costs. Its spend shows on its own instead.
		const unfinished = ended.filter((run) => run.status !== "finished");
		const { cost, tokenUse, unknown, free } = finishedCostOf(finished);
		return {
			name,
			last: lastRuns[0] ?? null,
			lastRuns,
			runs: recent.length,
			finished: finished.length,
			ended: ended.length,
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
			scores: scoresOf(recent),
			useful: usefulOf(recent),
			neededYou: neededYouOf(recent),
		};
	});
	return topRows(
		rows.sort(
			(a, b) =>
				b.runs - a.runs || (b.last?.startedAt ?? 0) - (a.last?.startedAt ?? 0),
		),
	);
}

/** The runs that did not finish, grouped by why, the most common first. */
function whyUnfinished(
	unfinished: readonly PlacedFlowRun[],
): UnfinishedReason[] {
	const byReason = new Map<string, UnfinishedReason>();
	for (const run of unfinished) {
		// A run without a reason of its own: its status (and caller) says why.
		const key =
			run.reason !== null
				? `reason:${run.reason}`
				: `status:${run.status}:${run.calledBy ?? ""}`;
		const row = byReason.get(key);
		byReason.set(key, {
			reason: run.reason,
			status: run.status,
			calledBy: run.calledBy,
			runs: (row?.runs ?? 0) + 1,
			// Runs come oldest first: the latest one wins.
			lastAt: run.startedAt,
		});
	}
	return [...byReason.values()].sort((a, b) => b.runs - a.runs);
}

/**
 * The warnings of the runs, grouped by node and message, the most common
 * first: a warning many runs share is a systematic problem, not bad luck.
 */
function warningsOf(runs: readonly PlacedFlowRun[]): FlowWarning[] {
	const byKey = new Map<string, FlowWarning & { runIds: Set<string> }>();
	for (const run of runs) {
		for (const warning of run.warnings) {
			const key = `${warning.nodeId ?? ""}\u0000${warning.message}`;
			const row = byKey.get(key) ?? {
				key,
				nodeId: warning.nodeId,
				message: warning.message,
				runs: 0,
				runIds: new Set<string>(),
				last: { runId: run.runId, at: warning.at },
			};
			row.runIds.add(run.runId);
			row.runs = row.runIds.size;
			if (warning.at >= row.last.at) {
				row.last = { runId: run.runId, at: warning.at };
			}
			byKey.set(key, row);
		}
	}
	return [...byKey.values()]
		.sort((a, b) => b.runs - a.runs)
		.map(({ runIds: _runIds, ...row }) => row);
}

/** One flow over the last `range` days. */
function flowRange(
	range: NightRange,
	mine: readonly PlacedFlowRun[],
	now: number,
	timeZone: string,
): FlowRange {
	const days = lastDays(range, now, timeZone);
	const first = days[0] ?? 0;
	const inRange = mine
		.filter((run) => run.day >= first)
		.sort((a, b) => a.startedAt - b.startedAt);
	const ended = inRange.filter(hasEnded);
	const finished = ended.filter((run) => run.status === "finished");
	const unfinished = ended.filter((run) => run.status !== "finished");
	const statuses = countStatuses(inRange);
	const dearest = ended.reduce<PlacedFlowRun | undefined>(
		(top, run) => (top === undefined || run.costUsd > top.costUsd ? run : top),
		undefined,
	);
	const { cost, tokenUse } = finishedCostOf(finished);
	const perNight: NightCounts[] = days.map((day) => {
		const counts: Record<string, number> = {};
		for (const { status } of statuses) counts[status] = 0;
		for (const run of inRange) {
			if (run.day === day) counts[run.status] = (counts[run.status] ?? 0) + 1;
		}
		return { night: day, counts };
	});
	return {
		nights: range,
		runs: inRange.length,
		asSubflow: inRange.filter((run) => run.calledBy !== null).length,
		ended: ended.length,
		finished: finished.length,
		unfinished: unfinished.length,
		cost,
		tokenUse,
		length: spreadOf(
			finished.flatMap((run) =>
				run.endedAt === null ? [] : [run.endedAt - run.startedAt],
			),
		),
		spent: sumKnownCost(inRange),
		spentTokens: inRange.reduce((total, run) => total + (run.tokens ?? 0), 0),
		spentUnfinished: sumKnownCost(unfinished),
		unfinishedTokens: unfinished.reduce(
			(total, run) => total + (run.tokens ?? 0),
			0,
		),
		dearest: dearest
			? {
					costUsd: dearest.costUsd,
					startedAt: dearest.startedAt,
					tokens: dearest.tokens,
				}
			: null,
		warnings: inRange.reduce((total, run) => total + run.warnings.length, 0),
		statuses,
		perNight,
		endedRuns: ended.map((run) => ({
			runId: run.runId,
			startedAt: run.startedAt,
			night: run.day,
			costUsd: run.costUsd,
			tokens: run.tokens,
			status: run.status,
		})),
		whyUnfinished: topRows(whyUnfinished(unfinished)),
		warningRows: topRows(warningsOf(inRange)),
		scores: scoresOf(inRange),
		useful: usefulOf(inRange),
		neededYou: neededYouOf(inRange),
		latest: inRange.slice(-OVERVIEW_ROWS).reverse().map(toFlowRun),
	};
}

/**
 * One flow in detail, for each day range: runs per day, what each run
 * cost, what a useful result cost, why runs did not finish, and the latest
 * runs. Runs as a subflow count, as in its Flow health row.
 */
export function summarizeFlow(
	name: string,
	runs: readonly RunSummary[],
	options: { now: number; timeZone: string },
): FlowHealthDetail {
	const mine = runsOf(name, runs, options.timeZone);
	return {
		name,
		ranges: NIGHT_RANGES.map((range) =>
			flowRange(range, mine, options.now, options.timeZone),
		),
	};
}
