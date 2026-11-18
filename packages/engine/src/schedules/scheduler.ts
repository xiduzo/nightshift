import type { Database } from "@nightshift/db";
import type { Schedule, ScheduleIssue } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { StartRunInput } from "../contract";
import type { ProjectFlows } from "../flows";
import type { RunLog, RunTrigger } from "../log";
import type { RunSummary } from "../read";
import type { RunStatus } from "../run-status";
import type { UsageNotes } from "../usage";
import { createScheduleTicker } from "./adapters/in/schedule-ticker";
import { drizzleScheduleLog } from "./adapters/out/drizzle-schedule-log";
import { fireDueSchedules } from "./application/fire-due-schedules";
import { openRunOf, openRunRefusalWords } from "./domain/open-run";
import type {
	ScheduleHistories,
	ScheduleRecord,
} from "./domain/schedule-history";
import {
	createScheduleWatch,
	type MissedScheduleTime,
} from "./domain/schedule-watch";
import { scheduledStart } from "./domain/scheduled-start";
import type { WebhookDelivery } from "./domain/webhook-delivery";

/**
 * The scheduler, as the engine still makes it: a facade over the tick's
 * use case (`application/fire-due-schedules.ts`) and its ticker
 * (`adapters/in/schedule-ticker.ts`). It goes when `wire.ts` binds them.
 */

export type SchedulerDeps = {
	db: Database;
	now: () => number;
	tickMs: number;
	/** Appends `ScheduleFired` and `ScheduleSkipped`. */
	log: RunLog;
	/** The projects a person has not removed, with their folder on this computer. */
	projects(): Promise<{ id: string }[]>;
	/** The schedules of each project. */
	flows: Pick<ProjectFlows, "schedules">;
	/** Starts a run of a flow file, with the trigger stored in `RunStarted`. */
	startRun(input: StartRunInput, trigger: RunTrigger): Promise<RunSummary>;
	/** The run's status, or null when the log knows no such run. */
	runStatus(runId: string): Promise<RunStatus | null>;
	/** Read on every tick: false skips the tick, like a pause of every schedule. Default on. */
	enabled?: () => boolean;
	/** Anonymous usage, when this computer records it. */
	usage?: UsageNotes;
	/**
	 * Whether this Device fires the schedule: the Space's Host, else the one
	 * Device of a Space without a Host, so a schedule every Clone reads
	 * fires once, and runs it there (ADR 15). Default:
	 * every schedule fires here.
	 */
	firesHere?: (projectId: string) => Promise<boolean>;
	/**
	 * A cron time was missed by more than its schedule allows, after its
	 * `ScheduleSkipped`. Not called for a pause or for an earlier run that
	 * still runs.
	 */
	missed?: (time: MissedScheduleTime) => void;
};

export type Scheduler = {
	/** Ticks now and then every `tickMs`, until `stop` or the signal aborts. */
	start(signal?: AbortSignal): void;
	stop(): void;
	/** One pass over every project. Ticks never overlap: a second call waits for the running one. */
	tick(): Promise<void>;
	/** Reads the schedule facts the log gained since the last read. */
	refresh(): Promise<void>;
	/**
	 * Holds the ticks: none starts a run until the release. Resolves once
	 * the tick under way ended, so its runs are in the log. The release
	 * ticks at once when the scheduler runs, and is safe to call twice.
	 */
	hold(): Promise<() => void>;
	last(projectId: string, scheduleId: string): ScheduleRecord | null;
	/**
	 * The next start: a due time that still starts on the next tick, else
	 * the next cron time. Paused tonight: the first cron time at or after
	 * the pause ends. Null when off.
	 */
	nextAt(projectId: string, schedule: Schedule, now: number): number | null;
	/**
	 * Starts the schedule's run now, as if it fired now, for `personId`
	 * when the schedule names no Person of its own. Refuses (`conflict`)
	 * while an earlier run of it is open, and a schedule without a flow.
	 */
	runNow(
		projectId: string,
		schedule: Schedule,
		personId: string | null,
	): Promise<RunSummary>;
};

export function createScheduler(deps: SchedulerDeps): Scheduler {
	const { now } = deps;
	/** It begins now: a cron time before this moment fell while the daemon was down. */
	const watch = createScheduleWatch(now());
	const log = drizzleScheduleLog({ db: deps.db, log: deps.log });
	/** The histories as the log gave them last. One live view: null before the first read. */
	let histories: ScheduleHistories | null = null;

	async function refresh(): Promise<ScheduleHistories> {
		histories = await log.histories();
		return histories;
	}

	const ticker = createScheduleTicker({
		tickMs: deps.tickMs,
		fire: fireDueSchedules({
			log,
			switch: { on: () => deps.enabled?.() ?? true },
			clock: now,
			projects: {
				all: () => deps.projects(),
				firesHere: async (projectId) =>
					deps.firesHere ? deps.firesHere(projectId) : true,
			},
			store: {
				list: (projectId, options) => deps.flows.schedules(projectId, options),
			},
			runs: { start: deps.startRun, status: deps.runStatus },
			notices: { missed: (time) => deps.missed?.(time) },
			...(deps.usage ? { usage: deps.usage } : {}),
			watch,
		}),
	});

	return {
		start: ticker.start,
		stop: ticker.stop,
		tick: ticker.tick,
		async refresh() {
			await refresh();
		},
		hold: ticker.hold,
		last(projectId, scheduleId) {
			return histories?.of(projectId, scheduleId)?.last ?? null;
		},
		async runNow(projectId, schedule, personId) {
			const { flow } = schedule;
			if (flow === undefined) {
				throw new Refusal("invalid", "This schedule starts no flow.");
			}
			const read = await refresh();
			const open = await openRunOf(
				read.of(projectId, schedule.id),
				deps.runStatus,
			);
			if (open) throw new Refusal("conflict", openRunRefusalWords(open));
			const at = now();
			const run = await deps.startRun(
				scheduledStart(projectId, schedule, flow, at, {
					startedBy: personId ?? undefined,
				}),
				{ kind: "schedule", scheduleId: schedule.id, at },
			);
			// A cron time before now counts as handled: it does not fire as well.
			await log.fired({
				projectId,
				scheduleId: schedule.id,
				at,
				runId: run.id,
				error: null,
			});
			return run;
		},
		nextAt(projectId, schedule, at) {
			return watch.nextStart(
				projectId,
				schedule,
				at,
				histories?.of(projectId, schedule.id),
			);
		},
	};
}

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
