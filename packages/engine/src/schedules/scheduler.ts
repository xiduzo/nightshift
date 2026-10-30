import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema";
import {
	latestCronTime,
	nextCronTimes,
	nextTimeOfDay,
	type Schedule,
	type ScheduleIssue,
} from "@nightshift/flows";
import { Refusal, wordsFor } from "@nightshift/refusal";
import { and, asc, gt, inArray } from "drizzle-orm";
import type { StartRunInput } from "../contract";
import type { ProjectFlows } from "../flows";
import {
	type EngineEventType,
	type LoggedEvent,
	parseEventRow,
	type RunLog,
	type RunStatus,
	type RunTrigger,
} from "../log";
import type { RunSummary } from "../read";
import type { WebhookDelivery } from "./webhooks";

/**
 * The scheduler: starts the runs of the projects' schedules when their
 * cron times come due. It lives inside the engine and ticks on an interval
 * (and once at start). Each tick reads every project's schedules again, so
 * an edit applies without a restart.
 *
 * Durable rules, all derived from the event log:
 * - A cron time fires at most once. The latest handled cron time of each
 *   schedule comes from `ScheduleFired`, `ScheduleSkipped` and the trigger
 *   of `RunStarted` (which closes the gap when the daemon dies between the
 *   start and the `ScheduleFired`).
 * - Only the latest due cron time counts. It fires when it is at most
 *   `SCHEDULE_GRACE_MS` late, for example after a daemon restart. Later than
 *   that it is skipped (`ScheduleSkipped`) when the scheduler watched it come
 *   due (the computer slept) or when it fell while the daemon was down for a
 *   schedule that fired before. A time from before a schedule existed or was
 *   resumed is ignored without a log entry.
 * - A schedule does not start while an earlier run of it is still running,
 *   waiting or sleeping: that cron time is skipped.
 * - A start that fails (flow errors, the run cap) is recorded with its error
 *   and not retried.
 * - A hold (`hold`, while a merge of Spaces moves rows) skips the ticks
 *   and changes nothing else: a cron time that came due meanwhile fires
 *   on the first tick after it, under the rules above.
 */

/** How late a cron time may still start. */
export const SCHEDULE_GRACE_MS = 15 * 60_000;
export const DEFAULT_SCHEDULE_TICK_MS = 30_000;
/** How many of a schedule's latest runs the overlap check looks at. */
const OVERLAP_LOOKBACK = 5;

/** How the latest handled cron time of a schedule went, as logged. */
export type ScheduleRecord =
	| { kind: "fired"; at: number; runId: string }
	| { kind: "failed"; at: number; error: string }
	| { kind: "skipped"; at: number; reason: string; runId: string | null };

type History = {
	/** The latest cron time that fired or was skipped. */
	lastAt: number;
	last: ScheduleRecord;
	/** The runs this schedule started, oldest first. */
	runIds: string[];
};

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
	/**
	 * Whether this Device fires the schedule: the Space's Host, else the one
	 * Device of a Space without a Host, so a schedule every Clone reads
	 * fires once. The Device it names (`device`) runs the run. Default:
	 * every schedule fires here.
	 */
	firesHere?: (projectId: string, schedule: Schedule) => Promise<boolean>;
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
	/** The next start: a due time that still starts on the next tick, else the next cron time. Null when paused. */
	nextAt(projectId: string, schedule: Schedule, now: number): number | null;
};

const SCHEDULE_EVENT_TYPES = [
	"RunStarted",
	"ScheduleFired",
	"ScheduleSkipped",
] as const satisfies readonly EngineEventType[];

const OPEN_STATUSES: readonly RunStatus[] = ["running", "waiting", "sleeping"];

/** A schedule the cron line starts: one with a cron line and a flow, and no webhook. */
type CronSchedule = Schedule & { cron: string; flow: string };

function keyOf(projectId: string, scheduleId: string): string {
	return `${projectId}/${scheduleId}`;
}

/** "45 min", "2 h 5 min", "3 days". */
function lateness(ms: number): string {
	const minutes = Math.floor(ms / 60_000);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) {
		return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
	}
	return `${Math.floor(hours / 24)} days`;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
	const { db, now } = deps;
	/** When the scheduler began: a cron time before it fell while the daemon was down. */
	const startedAt = now();
	const history = new Map<string, History>();
	/** The first tick that saw each enabled schedule. Forgotten while it is paused. */
	const watchedSince = new Map<string, number>();
	/** Whether the last tick found the scheduler switched off. */
	let off = false;
	/** The first tick after the scheduler was switched on again: a cron time before it neither fires nor counts as missed. */
	let onSince: number | null = null;
	let cursor = 0;
	let running: Promise<void> | null = null;
	let timer: ReturnType<typeof setInterval> | undefined;
	let stopped = false;
	/** How many holds are not released. */
	let holds = 0;

	function record(
		projectId: string,
		scheduleId: string,
		fact: ScheduleRecord,
	): void {
		const key = keyOf(projectId, scheduleId);
		const current = history.get(key);
		const runId = fact.kind === "fired" ? fact.runId : null;
		if (!current) {
			history.set(key, {
				lastAt: fact.at,
				last: fact,
				runIds: runId ? [runId] : [],
			});
			return;
		}
		if (runId && !current.runIds.includes(runId)) current.runIds.push(runId);
		if (fact.at >= current.lastAt) {
			current.lastAt = fact.at;
			current.last = fact;
		}
	}

	function apply(e: LoggedEvent): void {
		if (e.type === "RunStarted") {
			const trigger = e.payload.trigger;
			if (trigger?.kind !== "schedule" || !e.runId) return;
			record(e.payload.projectId, trigger.scheduleId, {
				kind: "fired",
				at: trigger.at,
				runId: e.runId,
			});
		} else if (e.type === "ScheduleFired") {
			const { projectId, scheduleId, at, runId, error } = e.payload;
			record(
				projectId,
				scheduleId,
				runId
					? { kind: "fired", at, runId }
					: { kind: "failed", at, error: error ?? "The run did not start." },
			);
		} else if (e.type === "ScheduleSkipped") {
			const { projectId, scheduleId, at, reason, runId } = e.payload;
			record(projectId, scheduleId, {
				kind: "skipped",
				at,
				reason,
				runId: runId ?? null,
			});
		}
	}

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
			apply(parseEventRow(row));
		}
	}

	/** An earlier run of the schedule that is still running, waiting or sleeping. */
	async function openRun(
		current: History | undefined,
	): Promise<{ runId: string; status: RunStatus } | null> {
		for (const runId of (current?.runIds ?? [])
			.slice(-OVERLAP_LOOKBACK)
			.reverse()) {
			const status = await deps.runStatus(runId);
			if (status && OPEN_STATUSES.includes(status)) return { runId, status };
		}
		return null;
	}

	async function skip(
		projectId: string,
		scheduleId: string,
		at: number,
		reason: string,
		runId: string | null = null,
	): Promise<void> {
		await deps.log.append({
			type: "ScheduleSkipped",
			payload: { projectId, scheduleId, at, reason, runId },
		});
		record(projectId, scheduleId, { kind: "skipped", at, reason, runId });
	}

	async function consider(
		projectId: string,
		schedule: CronSchedule,
		at: number,
	): Promise<void> {
		const key = keyOf(projectId, schedule.id);
		const due = latestCronTime(schedule.cron, at, schedule.timeZone);
		if (due === null) return;
		const current = history.get(key);
		if (current && due <= current.lastAt) return;
		// It came due while the scheduler was off.
		if (onSince !== null && due < onSince) return;

		const late = at - due;
		if (late > SCHEDULE_GRACE_MS) {
			const watched = watchedSince.get(key) ?? at;
			const missedWhileWatching = due >= watched;
			const missedWhileDown = current !== undefined && due < startedAt;
			if (missedWhileWatching || missedWhileDown) {
				await skip(
					projectId,
					schedule.id,
					due,
					`Missed by ${lateness(late)}. Night Shift was off, or the computer was asleep. A schedule starts at most ${SCHEDULE_GRACE_MS / 60_000} min late.`,
				);
			}
			return;
		}

		const open = await openRun(current);
		if (open) {
			await skip(
				projectId,
				schedule.id,
				due,
				`An earlier run of this schedule is still ${open.status}.`,
				open.runId,
			);
			return;
		}

		const stopAt = schedule.stopAt
			? (nextTimeOfDay(schedule.stopAt, at, schedule.timeZone) ?? undefined)
			: undefined;
		let runId: string | null = null;
		let error: string | null = null;
		try {
			const run = await deps.startRun(
				{
					projectId,
					flowName: schedule.flow,
					inputs: schedule.inputs,
					...(schedule.baseRef ? { baseRef: schedule.baseRef } : {}),
					...(stopAt !== undefined ? { stopAt } : {}),
					// The Device it names runs it; this computer only fires it.
					...(schedule.device ? { deviceName: schedule.device } : {}),
					// Another Person's schedule: their run, through the Offers here.
					...(schedule.person ? { startedBy: schedule.person } : {}),
				},
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
		await deps.log.append({
			type: "ScheduleFired",
			payload: { projectId, scheduleId: schedule.id, at: due, runId, error },
		});
		record(
			projectId,
			schedule.id,
			runId
				? { kind: "fired", at: due, runId }
				: { kind: "failed", at: due, error: error ?? "The run did not start." },
		);
	}

	async function pass(): Promise<void> {
		await refresh();
		if (holds > 0) return;
		if (deps.enabled && !deps.enabled()) {
			// Off counts as paused: turning it on again starts from now.
			watchedSince.clear();
			off = true;
			return;
		}
		const at = now();
		if (off) {
			off = false;
			onSince = at;
		}
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
				const key = keyOf(projectId, schedule.id);
				const { cron, flow } = schedule;
				// A webhook's schedule starts when the webhook arrives (`webhooks.ts`).
				if (
					cron === undefined ||
					flow === undefined ||
					schedule.webhook !== undefined ||
					!schedule.enabled ||
					(deps.firesHere && !(await deps.firesHere(projectId, schedule)))
				) {
					watchedSince.delete(key);
					continue;
				}
				if (!watchedSince.has(key)) watchedSince.set(key, at);
				await consider(projectId, { ...schedule, cron, flow }, at);
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
		refresh,
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
			return history.get(keyOf(projectId, scheduleId))?.last ?? null;
		},
		nextAt(projectId, schedule, at) {
			const { cron } = schedule;
			if (!schedule.enabled || cron === undefined || schedule.webhook) {
				return null;
			}
			const due = latestCronTime(cron, at, schedule.timeZone);
			const current = history.get(keyOf(projectId, schedule.id));
			if (
				due !== null &&
				(!current || due > current.lastAt) &&
				at - due <= SCHEDULE_GRACE_MS
			) {
				return due;
			}
			return nextCronTimes(cron, at, 1, schedule.timeZone)[0] ?? null;
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
