import type { Database } from "@nightshift/db";
import type { Schedule, ScheduleIssue } from "@nightshift/flows";
import { Refusal, wordsFor } from "@nightshift/refusal";
import type { StartRunInput } from "../contract";
import type { ProjectFlows } from "../flows";
import type { RunLog, RunTrigger } from "../log";
import type { RunSummary } from "../read";
import type { RunStatus } from "../run-status";
import type { UsageNotes } from "../usage";
import { drizzleScheduleLog } from "./adapters/out/drizzle-schedule-log";
import {
	openRunOf,
	openRunRefusalWords,
	openRunSkipWords,
} from "./domain/open-run";
import type {
	ScheduleHistories,
	ScheduleHistory,
	ScheduleRecord,
} from "./domain/schedule-history";
import {
	type CronSchedule,
	createScheduleWatch,
	cronScheduleOf,
	type MissedScheduleTime,
} from "./domain/schedule-watch";
import { scheduledStart } from "./domain/scheduled-start";
import type { WebhookDelivery } from "./domain/webhook-delivery";

/**
 * The scheduler: starts the runs of the projects' schedules when their
 * cron times come due. It lives inside the engine and ticks on an interval
 * (and once at start). Each tick reads every project's schedules again, so
 * an edit applies without a restart. The rules are in `domain/`:
 * `schedule-watch.ts` has them all, in words.
 */

export const DEFAULT_SCHEDULE_TICK_MS = 30_000;

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
	firesHere?: (projectId: string, schedule: Schedule) => Promise<boolean>;
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
	let running: Promise<void> | null = null;
	let timer: ReturnType<typeof setInterval> | undefined;
	let stopped = false;
	/** How many holds are not released. */
	let holds = 0;

	async function refresh(): Promise<ScheduleHistories> {
		histories = await log.histories();
		return histories;
	}

	async function skip(
		projectId: string,
		scheduleId: string,
		at: number,
		reason: string,
		runId: string | null = null,
	): Promise<void> {
		await log.skipped({ projectId, scheduleId, at, reason, runId });
		deps.usage?.note({ kind: "schedule-skipped", reason });
	}

	async function consider(
		projectId: string,
		schedule: CronSchedule,
		at: number,
		current: ScheduleHistory | undefined,
	): Promise<void> {
		const decision = watch.decide(projectId, schedule, at, current);
		if (decision.kind === "none") return;
		const { due } = decision;
		if (decision.kind === "missed") {
			await skip(projectId, schedule.id, due, decision.reason);
			try {
				deps.missed?.(decision.missed);
			} catch (error) {
				console.error(
					`[schedules] ${schedule.id}: telling of a miss failed`,
					error,
				);
			}
			return;
		}

		if (decision.kind === "paused") {
			await skip(projectId, schedule.id, due, decision.reason);
			return;
		}

		const open = await openRunOf(current, deps.runStatus);
		if (open) {
			await skip(
				projectId,
				schedule.id,
				due,
				openRunSkipWords(open),
				open.runId,
			);
			return;
		}

		let runId: string | null = null;
		let error: string | null = null;
		try {
			// It stops on the first stop time after now; its trigger keeps the cron time.
			const run = await deps.startRun(
				scheduledStart(projectId, schedule, schedule.flow, at),
				{ kind: "schedule", scheduleId: schedule.id, at: due },
			);
			runId = run.id;
		} catch (cause) {
			// The schedule shows why in words for people. A failure goes to the log.
			if (!(cause instanceof Refusal)) {
				console.error(`[schedules] ${schedule.id} did not start a run`, cause);
			}
			error = wordsFor(cause);
		}
		await log.fired({
			projectId,
			scheduleId: schedule.id,
			at: due,
			runId,
			error,
		});
		if (runId) deps.usage?.note({ kind: "schedule-fired" });
	}

	async function pass(): Promise<void> {
		const read = await refresh();
		if (holds > 0) return;
		if (deps.enabled && !deps.enabled()) {
			// Off counts as paused: turning it on again starts from now.
			watch.switchedOff();
			return;
		}
		const at = now();
		watch.switchedOn(at);
		for (const { id: projectId } of await deps.projects()) {
			if (stopped || holds > 0) return;
			let schedules: Schedule[];
			try {
				({ schedules } = await deps.flows.schedules(projectId, {
					validate: false,
				}));
			} catch {
				continue;
			}
			const seen = new Set<string>();
			for (const schedule of schedules) {
				if (stopped || holds > 0) return;
				// A duplicate id is an issue in the UI; the first one counts.
				if (seen.has(schedule.id)) continue;
				seen.add(schedule.id);
				// A webhook's schedule starts when the webhook arrives (`webhooks.ts`).
				const cron = cronScheduleOf(schedule);
				if (
					cron === null ||
					(deps.firesHere && !(await deps.firesHere(projectId, schedule)))
				) {
					watch.unwatch(projectId, schedule.id);
					continue;
				}
				watch.watch(projectId, schedule.id, at);
				await consider(projectId, cron, at, read.of(projectId, schedule.id));
			}
		}
	}

	function tick(): Promise<void> {
		if (running) return running;
		running = pass()
			.catch((error) => {
				if (!stopped)
					console.error("[nightshift] The scheduler tick failed:", error);
			})
			.finally(() => {
				running = null;
			});
		return running;
	}

	function stop(): void {
		stopped = true;
		if (timer !== undefined) clearInterval(timer);
		timer = undefined;
	}

	return {
		start(signal) {
			if (stopped || timer !== undefined) return;
			if (signal?.aborted) {
				stop();
				return;
			}
			signal?.addEventListener("abort", stop, { once: true });
			timer = setInterval(() => void tick(), deps.tickMs);
			// The HTTP server keeps the daemon alive; a test may end without stopping it.
			(timer as { unref?: () => void }).unref?.();
			void tick();
		},
		stop,
		tick,
		async refresh() {
			await refresh();
		},
		async hold() {
			holds++;
			let released = false;
			const release = () => {
				if (released) return;
				released = true;
				holds--;
				if (holds === 0 && timer !== undefined) void tick();
			};
			await running;
			return release;
		},
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
