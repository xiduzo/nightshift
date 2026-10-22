import type { RunStatus } from "../log";
import { isOpenStatus, type RunSummary } from "../read";
import {
	type DashboardRun,
	type KnownCost,
	OVERVIEW_ROWS,
	type Spread,
	type StatusCount,
	type TopRows,
} from "./types";

/** The small rules every part of the dashboard shares. */

/** Live statuses first, then how runs ended. */
export const STATUS_ORDER: RunStatus[] = [
	"running",
	"waiting",
	"sleeping",
	"finished",
	"failed",
	"interrupted",
	"stopped",
];

/** Whether a run is still open: at work, waiting at a Gate, or asleep. */
export function isOpen(run: { status: RunStatus }): boolean {
	return isOpenStatus(run.status);
}

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

/** How many runs have each status, in a fixed order, without the empty ones. */
export function countStatuses(
	runs: readonly { status: RunStatus }[],
): StatusCount[] {
	return STATUS_ORDER.flatMap((status) => {
		const count = runs.filter((run) => run.status === status).length;
		return count > 0 ? [{ status, count }] : [];
	});
}

/** The costs of several runs or steps together. */
export function sumKnownCost(
	costs: readonly {
		costUsd: number;
		costEstimated: boolean;
		costMissing: number;
	}[],
): KnownCost {
	return {
		costUsd: costs.reduce((sum, cost) => sum + cost.costUsd, 0),
		costEstimated: costs.some((cost) => cost.costEstimated),
		costMissing: costs.reduce((sum, cost) => sum + cost.costMissing, 0),
	};
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

/** A run as a dashboard list shows it. */
export function toDashboardRun(run: RunSummary, group: string): DashboardRun {
	return {
		id: run.id,
		title: run.title,
		status: run.status,
		createdAt: run.createdAt,
		reason: run.reason,
		wakeAt: run.wakeAt,
		branch: run.branch,
		costUsd: run.costUsd,
		costEstimated: run.costEstimated,
		costMissing: run.costMissing,
		group,
	};
}
