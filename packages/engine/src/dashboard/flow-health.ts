import type { RunSummary } from "../read";
import { lastNights, nightOf } from "./clock";
import {
	countStatuses,
	hasEnded,
	spreadOf,
	sumKnownCost,
	topRows,
} from "./stats";
import {
	type FlowHealthDetail,
	type FlowHealthRow,
	type FlowRange,
	type FlowRun,
	type FlowWarning,
	NIGHT_RANGES,
	type NightCounts,
	type NightRange,
	OVERVIEW_ROWS,
	type Spread,
	type TopRows,
	type UnfinishedReason,
} from "./types";

/** The nights a Flow health row covers. */
export const FLOW_HEALTH_NIGHTS = 30;

/** A run of a flow with its warnings and the night it started in. */
type PlacedFlowRun = Omit<FlowRun, "warnings"> & {
	warnings: RunSummary["warnings"];
	night: number;
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
						calledBy: null,
						reason: run.reason,
						warnings: run.warnings,
						night: nightOf(run.createdAt, timeZone),
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
				calledBy: run.title,
				reason: null,
				warnings: [],
				night: nightOf(subflow.startedAt, timeZone),
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
	unknown: number;
	free: number;
} {
	const costly = finished.filter((run) => run.costCalls > 0);
	return {
		cost: spreadOf(
			costly.filter((run) => run.costMissing === 0).map((run) => run.costUsd),
		),
		unknown: costly.filter((run) => run.costMissing > 0).length,
		free: finished.length - costly.length,
	};
}

function toFlowRun({ night: _night, ...run }: PlacedFlowRun): FlowRun {
	return { ...run, warnings: run.warnings.length };
}

/**
 * Each flow over the last 30 nights: its last run, how often it finished,
 * and what a finished run costs. A stopped run did not finish, so it counts
 * against it. A flow a Subflow node ran counts too, inside the run that
 * called it. The busiest flows first, then the one that ran last.
 */
export function flowHealthRows(
	flows: readonly string[],
	runs: readonly RunSummary[],
	now: number,
	timeZone: string,
): TopRows<FlowHealthRow> {
	const first = lastNights(FLOW_HEALTH_NIGHTS, now, timeZone)[0] ?? 0;
	const rows = flows.map((name): FlowHealthRow => {
		const mine = runsOf(name, runs, timeZone);
		const last = mine.reduce<PlacedFlowRun | undefined>(
			(latest, run) =>
				latest === undefined || run.startedAt > latest.startedAt ? run : latest,
			undefined,
		);
		const recent = mine.filter((run) => run.night >= first);
		const ended = recent.filter(hasEnded);
		const finished = ended.filter((run) => run.status === "finished");
		// A run that failed early spent next to nothing, which would drag down
		// what a run costs. Its spend shows on its own instead.
		const unfinished = ended.filter((run) => run.status !== "finished");
		const { cost, unknown, free } = finishedCostOf(finished);
		return {
			name,
			last: last
				? { runId: last.runId, status: last.status, startedAt: last.startedAt }
				: null,
			runs: recent.length,
			finished: finished.length,
			ended: ended.length,
			rate:
				ended.length > 0
					? Math.round((finished.length / ended.length) * 100)
					: null,
			cost,
			unknownCost: unknown,
			freeRuns: free,
			unfinished: {
				count: unfinished.length,
				costUsd: unfinished.reduce((total, run) => total + run.costUsd, 0),
			},
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

/** One flow over the last `range` nights. */
function flowRange(
	range: NightRange,
	mine: readonly PlacedFlowRun[],
	now: number,
	timeZone: string,
): FlowRange {
	const nights = lastNights(range, now, timeZone);
	const first = nights[0] ?? 0;
	const inRange = mine
		.filter((run) => run.night >= first)
		.sort((a, b) => a.startedAt - b.startedAt);
	const ended = inRange.filter(hasEnded);
	const finished = ended.filter((run) => run.status === "finished");
	const unfinished = ended.filter((run) => run.status !== "finished");
	const statuses = countStatuses(inRange);
	const dearest = ended.reduce<PlacedFlowRun | undefined>(
		(top, run) => (top === undefined || run.costUsd > top.costUsd ? run : top),
		undefined,
	);
	const perNight: NightCounts[] = nights.map((night) => {
		const counts: Record<string, number> = {};
		for (const { status } of statuses) counts[status] = 0;
		for (const run of inRange) {
			if (run.night === night)
				counts[run.status] = (counts[run.status] ?? 0) + 1;
		}
		return { night, counts };
	});
	return {
		nights: range,
		runs: inRange.length,
		asSubflow: inRange.filter((run) => run.calledBy !== null).length,
		ended: ended.length,
		finished: finished.length,
		unfinished: unfinished.length,
		cost: finishedCostOf(finished).cost,
		length: spreadOf(
			finished.flatMap((run) =>
				run.endedAt === null ? [] : [run.endedAt - run.startedAt],
			),
		),
		spent: sumKnownCost(inRange),
		spentUnfinished: sumKnownCost(unfinished),
		dearest: dearest
			? { costUsd: dearest.costUsd, startedAt: dearest.startedAt }
			: null,
		warnings: inRange.reduce((total, run) => total + run.warnings.length, 0),
		statuses,
		perNight,
		endedRuns: ended.map((run) => ({
			runId: run.runId,
			startedAt: run.startedAt,
			night: run.night,
			costUsd: run.costUsd,
			status: run.status,
		})),
		whyUnfinished: topRows(whyUnfinished(unfinished)),
		warningRows: topRows(warningsOf(inRange)),
		latest: inRange.slice(-OVERVIEW_ROWS).reverse().map(toFlowRun),
	};
}

/**
 * One flow in detail, for each night range: runs per night, what each run
 * cost, why runs did not finish, and the latest runs. Runs as a subflow
 * count, as in its Flow health row.
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
