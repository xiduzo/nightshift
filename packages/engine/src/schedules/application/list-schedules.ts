import type { Schedule, ScheduleIssue } from "@nightshift/flows";
import type { Actor } from "../../contract";
import type { RunStatus } from "../../run-status";
import { withoutEndedPause } from "../domain/pause-tonight";
import type { ScheduleRecord } from "../domain/schedule-history";
import type { ScheduleWatch } from "../domain/schedule-watch";
import {
	DELIVERIES_SHOWN,
	latestDeliveries,
	type WebhookDelivery,
	type WebhookRefusals,
} from "../domain/webhook-delivery";
import type {
	Clock,
	ScheduledProjects,
	ScheduledRuns,
	ScheduleLog,
	ScheduleStore,
} from "./ports";

/** How the last cron time of a schedule went. */
export type ScheduleResult =
	| {
			kind: "fired";
			/** The cron time (epoch ms). */
			at: number;
			runId: string;
			/** The run's status now. Null when the run is gone. */
			runStatus: RunStatus | null;
	  }
	/** The run did not start, for example the flow has errors or the run cap was reached. */
	| { kind: "failed"; at: number; error: string }
	/** The time was not started: missed while the daemon was down, or an earlier run still runs. */
	| {
			kind: "skipped";
			at: number;
			reason: string;
			/** The earlier run that still ran, when that is the reason. */
			runId: string | null;
	  };

export type ScheduleSummary = Schedule & {
	/** The next start (epoch ms). Null when paused, for a webhook, or when the cron line does not parse. */
	nextAt: number | null;
	/** How the last cron time went. Null for a webhook. */
	last: ScheduleResult | null;
	/** A webhook's latest deliveries, newest first. Empty for a cron line. */
	deliveries: WebhookDelivery[];
	/** Problems of this schedule. One with an error fails to start. */
	issues: ScheduleIssue[];
};

export type ScheduleList = {
	/** Where the schedules are. */
	path: string;
	schedules: ScheduleSummary[];
	/** Problems of the whole file, for example JSON that does not parse. */
	issues: ScheduleIssue[];
};

export type ListSchedulesPorts = {
	projects: Pick<ScheduledProjects, "inSpace">;
	store: Pick<ScheduleStore, "list">;
	log: Pick<ScheduleLog, "histories" | "deliveries">;
	runs: Pick<ScheduledRuns, "status">;
	clock: Clock;
	/** The watch of this engine: what its scheduler does next. */
	watch: Pick<ScheduleWatch, "nextStart">;
	/** The refused webhooks this engine remembers. */
	refusals: Pick<WebhookRefusals, "of">;
};

export type ListSchedules = { spaceId: string; projectId: string };

/**
 * The schedules of a project as a person reads them: each with its next
 * start, how its last cron time went (a webhook's: its latest
 * deliveries) and its issues. A pause that has ended is dropped. Refuses
 * (`not-found`) a project that is not in the Space.
 */
export const listSchedules =
	(ports: ListSchedulesPorts) =>
	async (
		_actor: Actor | undefined,
		request: ListSchedules,
	): Promise<ScheduleList> => {
		const { projects, store, log, runs, clock, watch, refusals } = ports;
		const { spaceId, projectId } = request;

		/** A logged schedule fact, with the status of the run it started. */
		async function resultOf(
			record: ScheduleRecord | null,
		): Promise<ScheduleResult | null> {
			if (!record) return null;
			if (record.kind !== "fired") return record;
			return { ...record, runStatus: await runs.status(record.runId) };
		}

		await projects.inSpace(projectId, spaceId);
		const loaded = await store.list(projectId);
		const histories = await log.histories();
		const at = clock();
		const schedules: ScheduleSummary[] = [];
		for (const stored of loaded.schedules) {
			const schedule = withoutEndedPause(stored, at);
			const history = histories.of(projectId, schedule.id);
			schedules.push({
				...schedule,
				nextAt: watch.nextStart(projectId, schedule, at, history),
				last: await resultOf(history?.last ?? null),
				deliveries: schedule.webhook
					? latestDeliveries(
							await log.deliveries(projectId, schedule.id, DELIVERIES_SHOWN),
							refusals.of(projectId, schedule.id),
						)
					: [],
				issues: loaded.issues.filter(
					(issue) => issue.scheduleId === schedule.id,
				),
			});
		}
		return {
			path: loaded.path,
			schedules,
			issues: loaded.issues.filter((issue) => issue.scheduleId === undefined),
		};
	};
