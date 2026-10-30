import type { FlowHealthRow } from "../dashboard";
import { hasEnded } from "../runs";
import type { ScheduleSummary } from "../schedules";
import type { FlowListItem } from "./types";

/**
 * One way a flow starts besides a person running it: a schedule, a
 * webhook, or a Subflow node in another flow.
 */
export type FlowStart =
	| { kind: "schedule"; schedule: ScheduleSummary }
	| { kind: "webhook"; schedule: ScheduleSummary }
	| { kind: "subflow"; caller: string };

/** Why a flow needs a look, or null. */
export type FlowProblem =
	| { kind: "does-not-load" }
	| { kind: "errors"; count: number }
	| { kind: "last-run-failed" };

/** A flow on the Flows page: what it is, what starts it, how its last runs went. */
export type FlowOverview = {
	flow: FlowListItem;
	/**
	 * Every way it starts besides you: its schedules and webhooks that are
	 * on (the next start first), the paused ones, then the flows that run it.
	 */
	starts: FlowStart[];
	/** It starts on its own: a schedule or a webhook of it is on. */
	startsOnItsOwn: boolean;
	/** Its last runs, newest first, and how many of the ended ones finished. */
	lastRuns: FlowHealthRow["lastRuns"];
	ended: number;
	finished: number;
	problem: FlowProblem | null;
};

/**
 * The project's flows for the Flows page, in the list's order, each with
 * its schedules, the flows that call it and its last runs (`flowHealth`
 * of the dashboard). A flow without a health row never ran.
 */
export function flowOverviews(
	flows: readonly FlowListItem[],
	schedules: readonly ScheduleSummary[],
	health: readonly FlowHealthRow[],
): FlowOverview[] {
	const healthOf = new Map(health.map((row) => [row.name, row]));
	return flows.map((flow) => {
		const own = schedules
			.filter((schedule) => schedule.flow === flow.name)
			.sort(
				(a, b) =>
					Number(b.enabled) - Number(a.enabled) ||
					(a.nextAt ?? Number.POSITIVE_INFINITY) -
						(b.nextAt ?? Number.POSITIVE_INFINITY),
			);
		const starts: FlowStart[] = [
			...own.map(
				(schedule): FlowStart =>
					schedule.webhook
						? { kind: "webhook", schedule }
						: { kind: "schedule", schedule },
			),
			...flow.callers.map((caller): FlowStart => ({ kind: "subflow", caller })),
		];
		const lastRuns = healthOf.get(flow.name)?.lastRuns ?? [];
		const ended = lastRuns.filter((run) => hasEnded(run.status));
		return {
			flow,
			starts,
			startsOnItsOwn: own.some((schedule) => schedule.enabled),
			lastRuns,
			ended: ended.length,
			finished: ended.filter((run) => run.status === "finished").length,
			problem: problemOf(flow, lastRuns[0]?.status),
		};
	});
}

function problemOf(
	flow: FlowListItem,
	last: FlowHealthRow["lastRuns"][number]["status"] | undefined,
): FlowProblem | null {
	if (flow.nodeCount === null) return { kind: "does-not-load" };
	if (flow.errorCount > 0) return { kind: "errors", count: flow.errorCount };
	if (last === "failed" || last === "interrupted") {
		return { kind: "last-run-failed" };
	}
	return null;
}
