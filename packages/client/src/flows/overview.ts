import type { FlowHealthRow } from "../dashboard";
import { hasEnded } from "../runs";
import type { ScheduleSummary } from "../schedules";
import type { FlowListItem } from "./types";

/**
 * One way a flow starts or continues besides a person: a schedule, a
 * webhook, a webhook that wakes its waiting runs (`signal`), or a
 * Subflow node in another flow.
 */
export type FlowStart =
	| { kind: "schedule"; schedule: ScheduleSummary }
	| { kind: "webhook"; schedule: ScheduleSummary }
	| { kind: "signal"; schedule: ScheduleSummary }
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
	 * on (the next start first), the paused ones, the webhooks that wake
	 * its waiting runs, then the flows that run it.
	 */
	starts: FlowStart[];
	/** Its schedules, in the order of `starts`: the ones that start it, then the ones that wake it. */
	schedules: ScheduleSummary[];
	/** It starts on its own: a schedule or a webhook of it is on. */
	startsOnItsOwn: boolean;
	/** Its last runs, newest first, and how many of the ended ones finished. */
	lastRuns: FlowHealthRow["lastRuns"];
	ended: number;
	finished: number;
	/**
	 * The newest report of its own runs, of any day. Null when none wrote
	 * one, and with an older Host.
	 */
	report: NonNullable<FlowHealthRow["report"]> | null;
	problem: FlowProblem | null;
};

/**
 * The project's flows for the Flows page, in the list's order, each with
 * its schedules, the flows that call it, its last runs and its newest
 * report (`flowHealth` of the dashboard). A flow without a health row
 * never ran.
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
		const wakers = schedules.filter((schedule) => wakes(schedule, flow));
		const starts: FlowStart[] = [
			...own.map(
				(schedule): FlowStart =>
					schedule.webhook
						? { kind: "webhook", schedule }
						: { kind: "schedule", schedule },
			),
			...wakers.map((schedule): FlowStart => ({ kind: "signal", schedule })),
			...flow.callers.map((caller): FlowStart => ({ kind: "subflow", caller })),
		];
		const row = healthOf.get(flow.name);
		const lastRuns = row?.lastRuns ?? [];
		const ended = lastRuns.filter((run) => hasEnded(run.status));
		return {
			flow,
			starts,
			schedules: [...own, ...wakers],
			startsOnItsOwn: own.some((schedule) => schedule.enabled),
			lastRuns,
			ended: ended.length,
			finished: ended.filter((run) => run.status === "finished").length,
			report: row?.report ?? null,
			problem: problemOf(flow, lastRuns[0]?.status),
		};
	});
}

/** A webhook that starts no flow and sends a signal one of the flow's Waits waits for. */
function wakes(schedule: ScheduleSummary, flow: FlowListItem): boolean {
	return (
		schedule.flow === undefined &&
		schedule.signal !== undefined &&
		flow.signals.includes(schedule.signal.name)
	);
}

/**
 * The schedules no flow holds: one that names a flow the project lacks,
 * and a webhook whose signal no Wait waits for. The Flows page lists them
 * apart, so you can fix or remove them.
 */
export function looseSchedules(
	flows: readonly FlowListItem[],
	schedules: readonly ScheduleSummary[],
): ScheduleSummary[] {
	return schedules.filter((schedule) =>
		schedule.flow === undefined
			? !flows.some((flow) => wakes(schedule, flow))
			: !flows.some((flow) => flow.name === schedule.flow),
	);
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
