import type { RunStatus, RunSummary } from "@/lib/api-types";

/** One run of a flow: a run of its own, or a Subflow run inside another run. */
export type FlowRun = {
	/** The run it is part of. */
	runId: string;
	status: RunStatus;
	startedAt: number;
	/** Null while it has not ended. */
	endedAt: number | null;
	costUsd: number;
	/** The title of the run that called it as a subflow. Null for a run of its own. */
	calledBy: string | null;
	/** Why a run of its own failed or ended. A subflow run has none of its own. */
	reason: string | null;
	/** Part of `costUsd` is estimated from tokens. */
	costEstimated: boolean;
	/** Steps that ended without a cost: their spend is not in `costUsd`. */
	costMissing: number;
	/** Agent sessions and model calls that ended. With none, it could not cost. */
	costCalls: number;
	/** The warnings of a run of its own. A subflow run shows its warnings in the run that called it. */
	warnings: RunSummary["warnings"];
};

/** The runs of the flow `name` in `runs`, on their own and as a subflow. */
export function runsOf(name: string, runs: RunSummary[]): FlowRun[] {
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
			})),
	]);
}

/**
 * Whether a run has ended. A run still going has not, and what it spent so
 * far is not its cost.
 */
export function hasEnded(run: FlowRun): boolean {
	return (
		run.status === "finished" ||
		run.status === "failed" ||
		run.status === "stopped" ||
		run.status === "interrupted"
	);
}

/** The five-number summary of a set of values, such as what runs cost. */
export type Spread = {
	min: number;
	q1: number;
	median: number;
	q3: number;
	max: number;
	/** How many values it covers. */
	count: number;
};

/** Linear interpolation between the closest ranks, like most spreadsheets. */
function quantile(sorted: number[], q: number): number {
	const at = (sorted.length - 1) * q;
	const below = sorted[Math.floor(at)] ?? 0;
	const above = sorted[Math.ceil(at)] ?? below;
	return below + (above - below) * (at - Math.floor(at));
}

export function spreadOf(values: number[]): Spread | undefined {
	if (values.length === 0) return undefined;
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

/**
 * What a finished run costs. A run with a step of unknown cost would look
 * cheaper than it was, so it is left out and counted in `unknown`. A run
 * that asked no agent or model, such as one that found nothing to do, cost
 * nothing for sure. It is left out too, counted in `free`, so it does not
 * drag the cost down.
 */
export function finishedCostOf(finished: FlowRun[]): {
	cost: Spread | undefined;
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
