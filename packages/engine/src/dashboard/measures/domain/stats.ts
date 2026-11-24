import type { RunStatus } from "../../../run-status";
import type { LatestReport } from "./flow-health-types";
import { OVERVIEW_ROWS, type Spread, type TopRows } from "./measure-types";
import type { RunIn } from "./runs";

/** The small rules every part of the dashboard shares. */

/**
 * Whether a run has ended. A run still going has not, and what it spent so
 * far is not its cost.
 */
export function hasEnded(run: { status: RunStatus }): boolean {
	return (
		run.status === "finished" ||
		run.status === "failed" ||
		run.status === "stopped" ||
		run.status === "interrupted"
	);
}

/** Tokens a run reported. Null when it sent no metrics. */
export function reportedTokens(run: {
	metrics?: { tokens: { input: number; output: number } } | undefined;
}): number | null {
	if (!run.metrics) return null;
	return run.metrics.tokens.input + run.metrics.tokens.output;
}

/** Linear interpolation between the closest ranks, like most spreadsheets. */
function quantile(sorted: number[], q: number): number {
	const at = (sorted.length - 1) * q;
	const below = sorted[Math.floor(at)] ?? 0;
	const above = sorted[Math.ceil(at)] ?? below;
	return below + (above - below) * (at - Math.floor(at));
}

/** The five-number summary of `values`. Null without values. */
export function spreadOf(values: readonly number[]): Spread | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return {
		min: sorted[0] ?? 0,
		q1: quantile(sorted, 0.25),
		median: quantile(sorted, 0.5),
		q3: quantile(sorted, 0.75),
		max: sorted.at(-1) ?? 0,
		count: sorted.length,
	};
}

/** The first rows of a ranked list, and its length. */
export function topRows<T>(
	rows: readonly T[],
	count = OVERVIEW_ROWS,
): TopRows<T> {
	return { rows: rows.slice(0, count), count: rows.length };
}

/**
 * A run's report as a dashboard list shows it, or null when the run has
 * none. A run with a report ended at an End node.
 */
export function toLatestReport(run: RunIn): LatestReport | null {
	const { report, endedAt, result } = run;
	if (!report || endedAt === null || result === null) return null;
	return {
		runId: run.id,
		stepId: report.stepId,
		endedAt,
		result,
		excerpt: report.excerpt,
		more: report.more,
	};
}
