import type { FlowRevisionItem } from "../flows";
import { isPlanned, type RunSummary } from "../read";
import { isTestRun } from "../run-status";
import { lastDays } from "./clock";
import { hasEnded } from "./stats";
import type {
	ChangeComparison,
	ChangeMeasure,
	ChangeRun,
	ChangeTrend,
	ChangeVerdict,
	FlowChange,
	FlowChanges,
	FlowMove,
	NightRange,
} from "./types";

/**
 * Before and after for one flow (Q17, docs/research/dashboards-2026-11.md):
 * did your last change help, and how do the days compare with the days
 * before? Only the flow's own ended runs count: a run as a subflow counts
 * in the run that called it, and a test run does not count.
 */

/** Saves closer than this are one change. */
const CHANGE_GAP_MS = 30 * 60_000;
/** The runs before a change that its runs after are measured against. */
export const BEFORE_RUNS = 10;
/** Fewer runs on a side: too few to tell. */
const VERDICT_MIN_RUNS = 3;
/** A number that moved by less than this share stayed the same. */
const SAME_SHARE = 0.1;

/** Revisions that change nothing a run does: Night Shift's own. */
const NOT_A_CHANGE: ReadonlySet<FlowRevisionItem["kind"]> = new Set([
	"upgrade",
	"infer",
]);

function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? null;
}

/** How long a run worked: its span without Gate waits and sleeps. */
function workMs(run: RunSummary): number | null {
	if (run.endedAt === null) return null;
	const idle = [
		...run.gates.map((gate) => ({ from: gate.openedAt, to: gate.closedAt })),
		...(run.sleeps ?? []),
	].reduce(
		(sum, span) =>
			sum + Math.max((span.to ?? run.endedAt ?? span.from) - span.from, 0),
		0,
	);
	return Math.max(run.endedAt - run.createdAt - idle, 0);
}

function unplannedOf(run: RunSummary): number {
	return (run.neededYou ?? []).filter((act) => !isPlanned(act)).length;
}

function gateWaitMs(run: RunSummary): number {
	return run.gates.reduce(
		(sum, gate) =>
			sum +
			Math.max(
				(gate.closedAt ?? run.endedAt ?? gate.openedAt) - gate.openedAt,
				0,
			),
		0,
	);
}

/** The numbers of one column of the table. */
export function measureRuns(runs: readonly RunSummary[]): ChangeMeasure {
	const finished = runs.filter((run) => run.status === "finished");
	let unplanned = 0;
	let wait = 0;
	let merged = 0;
	let closed = 0;
	let useful = 0;
	let rated = 0;
	for (const run of runs) {
		unplanned += unplannedOf(run);
		wait += gateWaitMs(run);
		const scores = run.metrics?.scores ?? [];
		if (scores.some((score) => score.score === "pr_merged")) merged++;
		else if (scores.some((score) => score.score === "pr_closed")) closed++;
		const answer = scores.filter((score) => score.score === "useful").at(-1);
		if (answer) {
			rated++;
			if (answer.value > 0) useful++;
		}
	}
	const per = Math.max(runs.length, 1);
	return {
		runs: runs.length,
		finished: finished.length,
		unplanned: unplanned / per,
		waitMs: wait / per,
		workMs: median(
			finished.map(workMs).filter((ms): ms is number => ms !== null),
		),
		costUsd: median(
			finished
				.filter((run) => run.costCalls > 0 && run.costMissing === 0)
				.map((run) => run.costUsd),
		),
		merged,
		closed,
		useful,
		rated,
	};
}

/** How `after` moved from `before`. Null on either side: the same. */
export function trendOf(
	after: number | null,
	before: number | null,
	lowerIsBetter: boolean,
): ChangeTrend {
	if (after === null || before === null) return "same";
	const scale = Math.max(Math.abs(before), Math.abs(after));
	if (scale === 0 || Math.abs(after - before) / scale < SAME_SHARE) {
		return "same";
	}
	return after < before === lowerIsBetter ? "better" : "worse";
}

function share(measure: ChangeMeasure): number | null {
	return measure.runs > 0 ? measure.finished / measure.runs : null;
}

/** Two sets of runs side by side, with how each number moved and a verdict. */
export function compareRuns(
	before: readonly RunSummary[],
	after: readonly RunSummary[],
): ChangeComparison {
	const b = measureRuns(before);
	const a = measureRuns(after);
	const trends = {
		finished: trendOf(share(a), share(b), false),
		unplanned: trendOf(a.unplanned, b.unplanned, true),
		waitMs: trendOf(a.waitMs, b.waitMs, true),
		workMs: trendOf(a.workMs, b.workMs, true),
		costUsd: trendOf(a.costUsd, b.costUsd, true),
	};
	return { before: b, after: a, verdict: verdictOf(a, b, trends), trends };
}

/** On the whole: on the finished share, the unplanned step-ins and the cost. */
function verdictOf(
	after: ChangeMeasure,
	before: ChangeMeasure,
	trends: ChangeComparison["trends"],
): ChangeVerdict {
	if (after.runs < VERDICT_MIN_RUNS || before.runs < VERDICT_MIN_RUNS) {
		return "few";
	}
	const counted = [trends.finished, trends.unplanned, trends.costUsd];
	const better = counted.filter((trend) => trend === "better").length;
	const worse = counted.filter((trend) => trend === "worse").length;
	if (better > worse) return "better";
	if (worse > better) return "worse";
	return "same";
}

/**
 * The revisions of a flow as changes, oldest first. Saves closer than 30
 * minutes are one change. Night Shift's own revisions, and saves that
 * only move steps on the canvas, are none.
 */
export function changesOf(
	revisions: readonly FlowRevisionItem[],
): FlowChange[] {
	const saves = revisions
		.filter(
			(revision) =>
				!NOT_A_CHANGE.has(revision.kind) && revision.changes?.empty !== true,
		)
		.sort((a, b) => a.at - b.at);
	const changes: FlowChange[] = [];
	for (const save of saves) {
		const diff = save.changes;
		const last = changes.at(-1);
		const change =
			last && save.at - last.at < CHANGE_GAP_MS
				? last
				: {
						firstAt: save.at,
						at: save.at,
						saves: 0,
						added: 0,
						removed: 0,
						changed: 0,
						edges: 0,
						settings: 0,
					};
		if (change !== last) changes.push(change);
		change.at = save.at;
		change.saves++;
		change.added += diff?.added ?? 0;
		change.removed += diff?.removed ?? 0;
		change.changed += diff?.changed ?? 0;
		change.edges += diff?.edges ?? 0;
		change.settings += diff?.other ?? 0;
	}
	return changes;
}

/** The flow's own ended runs that are no test, oldest first. */
export function ownEndedRuns(
	flowName: string,
	runs: readonly RunSummary[],
): RunSummary[] {
	return runs
		.filter(
			(run) => run.flowName === flowName && hasEnded(run) && !isTestRun(run),
		)
		.sort((a, b) => a.createdAt - b.createdAt);
}

function changeRun(run: RunSummary): ChangeRun {
	return {
		runId: run.id,
		startedAt: run.createdAt,
		finished: run.status === "finished",
		unplanned: unplannedOf(run),
		costUsd: run.costUsd,
	};
}

/**
 * Before and after for one flow over the last `nights` days, from its
 * runs (`runs` holds the flow's own ended runs, oldest first, as
 * {@link ownEndedRuns} gives them) and its revisions. `moves` and `read`
 * come from {@link nextMoves}.
 */
export function summarizeChanges(
	runs: readonly RunSummary[],
	revisions: readonly FlowRevisionItem[],
	options: {
		nights: NightRange;
		now: number;
		timeZone: string;
		moves: FlowMove[];
		read: number;
	},
): FlowChanges {
	const { nights, now } = options;
	const days = lastDays(nights * 2, now, options.timeZone);
	const from = days[0] ?? now;
	const split = days[nights] ?? now;
	const inDays = runs.filter((run) => run.createdAt >= split);
	const daysBefore = runs.filter(
		(run) => run.createdAt >= from && run.createdAt < split,
	);

	const changes = changesOf(revisions);
	const newest = changes.at(-1);
	const pending =
		newest && !runs.some((run) => run.createdAt > newest.at) ? newest : null;
	let lastChange: FlowChanges["lastChange"] = null;
	for (let index = changes.length - 1; index >= 0 && !lastChange; index--) {
		const change = changes[index];
		if (!change) continue;
		const next = changes[index + 1];
		const after = runs.filter(
			(run) =>
				run.createdAt > change.at && (!next || run.createdAt < next.firstAt),
		);
		if (after.length === 0) continue;
		const before = runs
			.filter((run) => run.createdAt < change.firstAt)
			.slice(-BEFORE_RUNS);
		lastChange = { change, ...compareRuns(before, after) };
	}

	return {
		nights,
		window: { from, split, to: now },
		runs: runs.filter((run) => run.createdAt >= from).map(changeRun),
		changes: changes.filter((change) => change.at >= from),
		pending,
		lastChange,
		days: compareRuns(daysBefore, inDays),
		moves: options.moves,
		read: options.read,
	};
}
