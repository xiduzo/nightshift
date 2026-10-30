/**
 * PROTOTYPE, throw away. One row per flow for the Flows page variants: the
 * flow file, what is in it, how its runs went (the dashboard's Flow
 * health) and everything that starts it. A flow can start in several ways
 * at once: you can always run it, schedules and webhooks can start it, and
 * Subflow nodes in other flows can run it.
 */

import { createDashboardQueries } from "@nightshift/client";
import { describeCron, type Flow, type FlowNodeType } from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";
import { flowQueries } from "@/features/flows";
import { scheduleQueries } from "@/features/schedules";
import {
	type FlowHealthRow,
	type FlowListItem,
	orpc,
	type ScheduleSummary,
} from "@/shared/api";

const dashboardQueries = createDashboardQueries(orpc);

/** One way a flow starts besides you running it. */
export type Trigger =
	| { kind: "schedule"; schedule: ScheduleSummary }
	| { kind: "webhook"; schedule: ScheduleSummary }
	| { kind: "subflow"; caller: string };

export type FlowRow = {
	name: string;
	flow: FlowListItem;
	/** Undefined while the numbers load, or when the flow never ran. */
	health: FlowHealthRow | undefined;
	/**
	 * Everything that starts it, besides you: the schedules and webhooks
	 * that are on (soonest first), the paused ones, then the calling flows.
	 */
	triggers: Trigger[];
	/** The schedule that starts it next, if one does. */
	next: ScheduleSummary | null;
	/** How many nodes of each type it has, most first. Empty until the flows load. */
	steps: { type: FlowNodeType; count: number }[];
	/** Gates a person decides: the run waits for you there. */
	gates: number;
	/** The flows its Subflow nodes run. */
	calls: string[];
	/** What blocks or worries this flow, in a few words. Null when all is well. */
	problem: { text: string; kind: "broken" | "failing" } | null;
};

export function useFlowRows(projectId: string): {
	rows: FlowRow[] | undefined;
	healthNights: number | undefined;
	error: Error | null;
} {
	const list = useQuery(flowQueries.list(projectId));
	const map = useQuery(flowQueries.map(projectId));
	const summary = useQuery(dashboardQueries.summary({ projectId }));
	const schedules = useQuery(scheduleQueries.listLive(projectId));

	if (!list.data) {
		return { rows: undefined, healthNights: undefined, error: list.error };
	}
	const health = new Map(
		(summary.data?.flowHealth?.rows ?? []).map((row) => [row.name, row]),
	);
	const all = schedules.data?.schedules ?? [];
	const rows = list.data.map((flow): FlowRow => {
		const own = all
			.filter((schedule) => schedule.flow === flow.name)
			.sort(
				(a, b) =>
					Number(b.enabled) - Number(a.enabled) ||
					(a.nextAt ?? Number.POSITIVE_INFINITY) -
						(b.nextAt ?? Number.POSITIVE_INFINITY),
			);
		const next =
			own.find((schedule) => schedule.enabled && schedule.nextAt !== null) ??
			null;
		const triggers: Trigger[] = [
			...own.map(
				(schedule): Trigger =>
					schedule.webhook
						? { kind: "webhook", schedule }
						: { kind: "schedule", schedule },
			),
			...flow.callers.map((caller): Trigger => ({ kind: "subflow", caller })),
		];
		const row = health.get(flow.name);
		return {
			name: flow.name,
			flow,
			health: row,
			triggers,
			next,
			...contentsOf(map.data?.[flow.name] ?? null),
			problem: problemOf(flow, row),
		};
	});
	return {
		rows,
		healthNights: summary.data?.healthNights,
		error: null,
	};
}

function contentsOf(
	flow: Flow | null,
): Pick<FlowRow, "steps" | "gates" | "calls"> {
	if (!flow) return { steps: [], gates: 0, calls: [] };
	const counts = new Map<FlowNodeType, number>();
	let gates = 0;
	const calls = new Set<string>();
	for (const node of flow.nodes) {
		counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
		if (node.type === "decision" && node.by === "person") gates += 1;
		if (node.type === "call") calls.add(node.flow);
	}
	const steps = [...counts]
		.filter(([type]) => type !== "end")
		.map(([type, count]) => ({ type, count }))
		.sort((a, b) => b.count - a.count);
	return { steps, gates, calls: [...calls] };
}

function problemOf(
	flow: FlowListItem,
	health: FlowHealthRow | undefined,
): FlowRow["problem"] {
	if (flow.nodeCount === null) return { text: "Does not load", kind: "broken" };
	if (flow.errorCount > 0) {
		return {
			text: `${flow.errorCount} ${flow.errorCount === 1 ? "error" : "errors"}`,
			kind: "broken",
		};
	}
	const last = health?.last?.status;
	if (last === "failed" || last === "interrupted") {
		return { text: "Last run failed", kind: "failing" };
	}
	return null;
}

/** When a schedule starts the flow, in words: its cron line, or a webhook. */
export function scheduleText(schedule: ScheduleSummary): string {
	if (schedule.webhook) return "When a webhook arrives";
	if (!schedule.cron) return "Never";
	const text = describeCron(schedule.cron);
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Starts on its own: a schedule or webhook that is on. */
export function startsOnItsOwn(row: FlowRow): boolean {
	return row.triggers.some(
		(trigger) => trigger.kind !== "subflow" && trigger.schedule.enabled,
	);
}
