import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema";
import { and, asc, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
	type EngineEventType,
	type LoggedEvent,
	parseEventRow,
	type RunLog,
} from "../../../log";
import type { ScheduleLog } from "../../application/ports";
import {
	createScheduleHistories,
	type ScheduleFact,
} from "../../domain/schedule-history";
import {
	deliveryOf,
	type WebhookDelivery,
} from "../../domain/webhook-delivery";

/**
 * The schedule facts in the event log (`event` rows): `ScheduleFired`,
 * `ScheduleSkipped`, the trigger of `RunStarted`, and `WebhookReceived`.
 * It keeps the histories in memory and reads only the rows the log gained
 * since its last read. A new one over the same database reads them all
 * again: that is a restart.
 */
export type DrizzleScheduleLogDeps = {
	db: Database;
	/** Appends `ScheduleFired`, `ScheduleSkipped` and `WebhookReceived`. */
	log: Pick<RunLog, "append">;
};

const SCHEDULE_EVENT_TYPES = [
	"RunStarted",
	"ScheduleFired",
	"ScheduleSkipped",
] as const satisfies readonly EngineEventType[];

/** What a logged event tells of a schedule, or null: a run that no schedule started. */
function factOf(e: LoggedEvent): ScheduleFact | null {
	if (e.type === "RunStarted") {
		const trigger = e.payload.trigger;
		if (trigger?.kind !== "schedule" || !e.runId) return null;
		return {
			kind: "run-started",
			projectId: e.payload.projectId,
			scheduleId: trigger.scheduleId,
			at: trigger.at,
			runId: e.runId,
		};
	}
	if (e.type === "ScheduleFired") {
		const { projectId, scheduleId, at, runId, error } = e.payload;
		return { kind: "fired", projectId, scheduleId, at, runId, error };
	}
	if (e.type === "ScheduleSkipped") {
		const { projectId, scheduleId, at, reason, runId } = e.payload;
		return {
			kind: "skipped",
			projectId,
			scheduleId,
			at,
			reason,
			runId: runId ?? null,
		};
	}
	return null;
}

export function drizzleScheduleLog(deps: DrizzleScheduleLogDeps): ScheduleLog {
	const { db, log } = deps;
	const histories = createScheduleHistories();
	let cursor = 0;

	async function refresh(): Promise<void> {
		const rows = await db
			.select()
			.from(event)
			.where(
				and(
					gt(event.seq, cursor),
					inArray(event.type, [...SCHEDULE_EVENT_TYPES]),
				),
			)
			.orderBy(asc(event.seq));
		for (const row of rows) {
			cursor = Math.max(cursor, row.seq);
			const fact = factOf(parseEventRow(row));
			if (fact) histories.apply(fact);
		}
	}

	return {
		async histories() {
			await refresh();
			return histories;
		},

		async fired(fact) {
			const { projectId, scheduleId, at, runId, error } = fact;
			await log.append({
				type: "ScheduleFired",
				payload: { projectId, scheduleId, at, runId, error },
			});
			histories.apply({ kind: "fired", ...fact });
		},

		async skipped(fact) {
			const { projectId, scheduleId, at, reason, runId } = fact;
			await log.append({
				type: "ScheduleSkipped",
				payload: { projectId, scheduleId, at, reason, runId },
			});
			histories.apply({ kind: "skipped", ...fact });
		},

		async received(fact) {
			const { projectId, scheduleId, at, result, runId, woke, error } = fact;
			await log.append({
				type: "WebhookReceived",
				payload: { projectId, scheduleId, at, result, runId, woke, error },
			});
		},

		async deliveries(projectId, scheduleId, limit) {
			const rows = await db
				.select()
				.from(event)
				.where(
					and(
						eq(event.type, "WebhookReceived"),
						sql`json_extract(${event.payload}, '$.projectId') = ${projectId}`,
						sql`json_extract(${event.payload}, '$.scheduleId') = ${scheduleId}`,
					),
				)
				.orderBy(desc(event.seq))
				.limit(limit);
			const logged: WebhookDelivery[] = [];
			for (const row of rows) {
				const e = parseEventRow(row);
				if (e.type !== "WebhookReceived") continue;
				logged.push(deliveryOf(e.payload));
			}
			return logged;
		},
	};
}
