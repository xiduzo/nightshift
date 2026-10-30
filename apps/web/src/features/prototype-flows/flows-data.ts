/**
 * PROTOTYPE, throw away. One row per flow for the Flows page variants: the
 * flow file, how its runs went (the dashboard's Flow health) and the
 * schedules that start it.
 */

import { createDashboardQueries } from "@nightshift/client";
import { describeCron } from "@nightshift/flows";
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

/** How a flow starts: what the page groups and filters by. */
export type StartKind = "schedule" | "webhook" | "subflow" | "manual";

export type FlowRow = {
	name: string;
	flow: FlowListItem;
	/** Undefined while the numbers load, or when the flow never ran. */
	health: FlowHealthRow | undefined;
	/** The schedules that start this flow. */
	schedules: ScheduleSummary[];
	start: StartKind;
	/** The schedule that starts it next, if one does. */
	next: ScheduleSummary | null;
	/** What blocks or worries this flow, in a few words. Null when all is well. */
	problem: { text: string; kind: "broken" | "failing" } | null;
};

export function useFlowRows(projectId: string): {
	rows: FlowRow[] | undefined;
	healthNights: number | undefined;
	error: Error | null;
} {
	const list = useQuery(flowQueries.list(projectId));
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
		const own = all.filter((schedule) => schedule.flow === flow.name);
		const on = own.filter((schedule) => schedule.enabled);
		const next =
			on
				.filter((schedule) => schedule.nextAt !== null)
				.sort((a, b) => (a.nextAt ?? 0) - (b.nextAt ?? 0))[0] ??
			on[0] ??
			null;
		const start: StartKind = on.some((schedule) => schedule.cron)
			? "schedule"
			: on.some((schedule) => schedule.webhook)
				? "webhook"
				: flow.callers.length > 0
					? "subflow"
					: "manual";
		const row = health.get(flow.name);
		return {
			name: flow.name,
			flow,
			health: row,
			schedules: own,
			start,
			next,
			problem: problemOf(flow, row),
		};
	});
	return {
		rows,
		healthNights: summary.data?.healthNights,
		error: null,
	};
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

export const START_LABEL: Record<StartKind, string> = {
	schedule: "On a schedule",
	webhook: "On a webhook",
	subflow: "Inside other flows",
	manual: "When you start it",
};
