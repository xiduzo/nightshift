import {
	isPlanned,
	type NeededYou,
	type NeededYouReason,
	type RunSummary,
} from "../read";
import { isTestRun } from "../run-status";
import { DAY_MS } from "./clock";
import { hasEnded, spreadOf } from "./stats";
import type {
	AttentionCause,
	FlowAttention,
	FlowLevel,
	FlowSignal,
	FlowWatch,
	SpaceWatch,
	WatchedFlow,
} from "./types";

/**
 * The watch over a flow (docs/research/dashboards-2026-11.md): how much it
 * still needs a person, and whether it still does what it usually does.
 * All of it is measured from the flow's own runs. A run as a subflow
 * counts in the run that called it, and a test run does not count.
 *
 * - The level is how often a person stepped in on its last runs.
 * - Attention counts each step-in, planned or not (`NeededYou.planned`).
 * - A signal is one way the flow left its usual range. Nobody sets a
 *   threshold: the range is what its runs before did.
 */

/** How many of a flow's last ended runs set its level. */
export const LEVEL_RUNS = 10;
/** A flow with fewer ended runs has no level yet. */
export const LEVEL_MIN_RUNS = 3;
/** The weeks of `perWeek`, the last one ending now. */
export const ATTENTION_WEEKS = 12;
/** How many runs before the last one make the usual range. */
const USUAL_RUNS = 20;
/** Fewer runs before it: no usual range yet. */
const USUAL_MIN_RUNS = 5;
/** The last run is unusual when it is past the range and past this many times the median. */
const UNUSUAL_FACTOR = 2;
/** How many runs in a row with nothing to do make a signal. */
const NOTHING_RUNS = 3;
/** A flow fails for good when this many runs in a row failed. */
const SEVERE_FAILS = 2;

const WEEK_MS = 7 * DAY_MS;

/** One run of a flow as the watch reads it. */
export type WatchRun = {
	id: string;
	createdAt: number;
	endedAt: number | null;
	status: RunSummary["status"];
	result: RunSummary["result"];
	costUsd: number;
	/** The cost is whole: it asked an agent or a model, and each step said what it cost. */
	costKnown: boolean;
	/** How long it worked: its span without the time it slept or waited for a person. */
	workMs: number;
	acts: readonly NeededYou[];
};

/** How long a run worked until `now`: its span without sleeps and Gate waits. */
function workMsOf(run: RunSummary, now: number): number {
	const end = run.endedAt ?? now;
	const idle = [
		...run.gates.map((gate) => ({ from: gate.openedAt, to: gate.closedAt })),
		...(run.sleeps ?? []),
	].reduce((sum, span) => sum + Math.max((span.to ?? end) - span.from, 0), 0);
	return Math.max(end - run.createdAt - idle, 0);
}

export function toWatchRun(run: RunSummary, now: number): WatchRun {
	return {
		id: run.id,
		createdAt: run.createdAt,
		endedAt: run.endedAt,
		status: run.status,
		result: run.result,
		costUsd: run.costUsd,
		costKnown: run.costCalls > 0 && run.costMissing === 0,
		workMs: workMsOf(run, now),
		acts: run.neededYou ?? [],
	};
}

/**
 * The level of the runs, newest first: You decide when a person stepped
 * in on more than half, On its own when on none, else You check. Null
 * with too few runs.
 */
function levelOf(ended: readonly WatchRun[]): FlowLevel | null {
	const last = ended.slice(0, LEVEL_RUNS);
	if (last.length < LEVEL_MIN_RUNS) return null;
	const withPerson = last.filter((run) => run.acts.length > 0).length;
	if (withPerson === 0) return "own";
	return withPerson * 2 > last.length ? "decide" : "check";
}

/**
 * The level now, and the start of the oldest run from which every window
 * of last runs gave that level.
 */
function levelSince(
	ended: readonly WatchRun[],
): { level: FlowLevel; since: number } | null {
	const level = levelOf(ended);
	const newest = ended[0];
	if (level === null || !newest) return null;
	let since = newest.createdAt;
	for (let from = 1; from < ended.length; from++) {
		if (levelOf(ended.slice(from)) !== level) break;
		since = ended[from]?.createdAt ?? since;
	}
	return { level, since };
}

function countActs(acts: readonly NeededYou[]) {
	const planned = acts.filter(isPlanned).length;
	return { planned, unplanned: acts.length - planned };
}

/** The unplanned step-ins per week, oldest first, the last week ending at `now`. */
function perWeekOf(acts: readonly NeededYou[], now: number): number[] {
	const weeks = Array.from({ length: ATTENTION_WEEKS }, () => 0);
	for (const act of acts) {
		if (isPlanned(act)) continue;
		const ago = Math.floor((now - act.at) / WEEK_MS);
		if (ago >= 0 && ago < ATTENTION_WEEKS) {
			weeks[ATTENTION_WEEKS - 1 - ago] =
				(weeks[ATTENTION_WEEKS - 1 - ago] ?? 0) + 1;
		}
	}
	return weeks;
}

/** Why, one row per reason and node: the unplanned first, then the most times. */
function causesOf(acts: readonly NeededYou[]): AttentionCause[] {
	const byKey = new Map<string, AttentionCause & { at: number }>();
	for (const act of acts) {
		const planned = isPlanned(act);
		const key = `${act.reason}\n${planned}\n${act.nodeId ?? ""}`;
		const row = byKey.get(key) ?? {
			reason: act.reason as NeededYouReason,
			planned,
			times: 0,
			at: 0,
		};
		row.times += 1;
		if (act.at >= row.at) {
			row.at = act.at;
			if (act.nodeId !== undefined) row.nodeId = act.nodeId;
			if (act.question !== undefined) row.question = act.question;
		}
		byKey.set(key, row);
	}
	return [...byKey.values()]
		.sort((a, b) => Number(a.planned) - Number(b.planned) || b.times - a.times)
		.map(({ at: _at, ...row }) => row);
}

/** How often the runs started in the range needed a person, against as many days before. */
function attentionOf(
	runs: readonly WatchRun[],
	now: number,
	first: number,
): FlowAttention {
	const before = first - (now - first);
	const inRange = runs
		.filter((run) => run.createdAt >= first)
		.flatMap((run) => run.acts);
	const earlier = runs
		.filter((run) => run.createdAt >= before && run.createdAt < first)
		.flatMap((run) => run.acts);
	return {
		...countActs(inRange),
		before: countActs(earlier),
		causes: causesOf(inRange),
		perWeek: perWeekOf(
			runs.flatMap((run) => run.acts),
			now,
		),
	};
}

/**
 * The last value against the values before it: unusual when it is past
 * the highest of them and past twice their median.
 */
function unusual(
	last: number,
	before: readonly number[],
): { low: number; high: number } | null {
	const usual = spreadOf(before.slice(0, USUAL_RUNS));
	if (!usual || usual.count < USUAL_MIN_RUNS) return null;
	if (last <= usual.max || last <= usual.median * UNUSUAL_FACTOR) return null;
	return { low: usual.min, high: usual.max };
}

/** The ways the flow left its usual range, the severe first. Runs newest first. */
function signalsOf(runs: readonly WatchRun[]): FlowSignal[] {
	const signals: FlowSignal[] = [];
	const ended = runs.filter(hasEnded);
	const finished = ended.filter((run) => run.status === "finished");

	const failedInRow = ended.findIndex((run) => run.status !== "failed");
	const fails = ended.slice(0, failedInRow < 0 ? ended.length : failedInRow);
	const newestFail = fails[0];
	if (newestFail) {
		signals.push({
			kind: "failing",
			severe: fails.length >= SEVERE_FAILS,
			since: fails.at(-1)?.createdAt ?? newestFail.createdAt,
			runId: newestFail.id,
			count: fails.length,
		});
	}

	const doneAt = finished.findIndex((run) => run.result !== "nothing-to-do");
	const nothing = finished.slice(0, doneAt < 0 ? finished.length : doneAt);
	const earlier = finished.slice(nothing.length, nothing.length + USUAL_RUNS);
	const newestNothing = nothing[0];
	if (
		newestNothing &&
		newestFail === undefined &&
		nothing.length >= NOTHING_RUNS &&
		earlier.length >= USUAL_MIN_RUNS &&
		earlier.filter((run) => run.result === "done").length * 2 > earlier.length
	) {
		signals.push({
			kind: "nothing",
			severe: false,
			since: nothing.at(-1)?.createdAt ?? newestNothing.createdAt,
			runId: newestNothing.id,
			count: nothing.length,
		});
	}

	const costly = finished.filter((run) => run.costKnown);
	const lastCostly = costly[0];
	const cost =
		lastCostly &&
		unusual(
			lastCostly.costUsd,
			costly.slice(1).map((run) => run.costUsd),
		);
	if (lastCostly && cost) {
		signals.push({
			kind: "cost",
			severe: false,
			since: lastCostly.createdAt,
			runId: lastCostly.id,
			now: lastCostly.costUsd,
			usual: cost,
		});
	}

	const open = runs.find((run) => run.status === "running");
	const lengths = finished.map((run) => run.workMs);
	const slow = open && unusual(open.workMs, lengths);
	const lastFinished = finished[0];
	const long = lastFinished && unusual(lastFinished.workMs, lengths.slice(1));
	if (open && slow) {
		signals.push({
			kind: "slow",
			severe: false,
			since: open.createdAt,
			runId: open.id,
			now: open.workMs,
			usual: slow,
		});
	} else if (lastFinished && long) {
		signals.push({
			kind: "length",
			severe: false,
			since: lastFinished.createdAt,
			runId: lastFinished.id,
			now: lastFinished.workMs,
			usual: long,
		});
	}
	return signals.sort((a, b) => Number(b.severe) - Number(a.severe));
}

/**
 * The watch over one flow, from its own real runs in any order: its level,
 * how often the runs started since `first` needed a person, how long a
 * finished run of those works, and its signals.
 */
export function flowWatch(
	runs: readonly WatchRun[],
	now: number,
	first: number,
): FlowWatch {
	const newestFirst = [...runs].sort((a, b) => b.createdAt - a.createdAt);
	return {
		level: levelSince(newestFirst.filter(hasEnded)),
		attention: attentionOf(newestFirst, now, first),
		length: spreadOf(
			newestFirst
				.filter((run) => run.status === "finished" && run.createdAt >= first)
				.map((run) => run.workMs),
		),
		signals: signalsOf(newestFirst),
	};
}

/**
 * The severe signal that the end of one run turned on: the flow shows a
 * severe signal with that run, and none without it. Null: the run is not
 * among `runs`, it did not end, nothing is severe, or the flow was severe
 * already. A flow that stays severe turns on nothing new. A flow that got
 * back into its range can turn severe again.
 */
export function turnedSevere(
	runs: readonly WatchRun[],
	runId: string,
): FlowSignal | null {
	const ended = runs.find((run) => run.id === runId);
	if (!ended || !hasEnded(ended)) return null;
	const newestFirst = [...runs].sort((a, b) => b.createdAt - a.createdAt);
	const severe = signalsOf(newestFirst).find((signal) => signal.severe);
	if (!severe) return null;
	const before = signalsOf(newestFirst.filter((run) => run.id !== runId));
	return before.some((signal) => signal.severe) ? null : severe;
}

/** The own real runs of one flow of one project, as the watch reads them. */
export function watchRunsOf(
	name: string,
	runs: readonly RunSummary[],
	now: number,
): WatchRun[] {
	return runs
		.filter((run) => run.flowName === name && !isTestRun(run))
		.map((run) => toWatchRun(run, now));
}

/**
 * The watch over every flow of `runs`: the unplanned step-ins per week,
 * how many flows are at each level, and the flows with a signal, the
 * severe first, then the newest signal. A quick run has no flow, and is
 * not in it.
 */
export function spaceWatch(
	runs: readonly RunSummary[],
	now: number,
	first: number,
): SpaceWatch {
	const byFlow = new Map<string, RunSummary[]>();
	for (const run of runs) {
		if (run.flowName === null || isTestRun(run)) continue;
		const key = `${run.projectId}/${run.flowName}`;
		byFlow.set(key, [...(byFlow.get(key) ?? []), run]);
	}
	const levels: Record<FlowLevel, number> = { decide: 0, check: 0, own: 0 };
	const flows: WatchedFlow[] = [];
	const perWeek = Array.from({ length: ATTENTION_WEEKS }, () => 0);
	for (const [key, ofFlow] of byFlow) {
		const newest = ofFlow.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
		const watch = flowWatch(
			ofFlow.map((run) => toWatchRun(run, now)),
			now,
			first,
		);
		if (watch.level) levels[watch.level.level] += 1;
		watch.attention.perWeek.forEach((count, week) => {
			perWeek[week] = (perWeek[week] ?? 0) + count;
		});
		if (watch.signals.length === 0) continue;
		flows.push({
			key,
			projectId: newest.projectId,
			flow: newest.flowName ?? "",
			level: watch.level,
			signals: watch.signals,
			lastAt: newest.createdAt,
		});
	}
	const newestSignal = (flow: WatchedFlow) =>
		Math.max(...flow.signals.map((signal) => signal.since));
	return {
		perWeek,
		levels,
		watched: byFlow.size,
		flows: flows.sort(
			(a, b) =>
				Number(b.signals.some((s) => s.severe)) -
					Number(a.signals.some((s) => s.severe)) ||
				newestSignal(b) - newestSignal(a),
		),
	};
}
