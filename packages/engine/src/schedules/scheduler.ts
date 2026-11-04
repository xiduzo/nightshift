import type { Database } from "@nightshift/db";
import { event } from "@nightshift/db/schema";
import {
	lateMinutesOf,
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
import type { UsageNotes } from "../usage";
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
 *   `SCHEDULE_GRACE_MS` late, for example after a daemon restart. A time
 *   that was missed fires up to the schedule's own `lateMinutes` late
 *   (default 15): one the scheduler watched come due (the computer slept),
 *   or one that fell while the daemon was down for a schedule that fired
 *   or was skipped before. Its run's trigger keeps the cron time, so the
 *   run knows when it was due (`{{run.due_at}}`). Later than that window
 *   a missed time is skipped (`ScheduleSkipped`) and `missed` tells the
 *   people of the Space. A time from before a schedule existed or was
 *   resumed is ignored without a log entry.
 * - A schedule does not start while an earlier run of it is still running,
 *   waiting or sleeping: that cron time is skipped.
 * - A start that fails (flow errors, the run cap) is recorded with its error
 *   and not retried.
 * - A hold (`hold`, while a merge of Spaces moves rows) skips the ticks
 *   and changes nothing else: a cron time that came due meanwhile fires
 *   on the first tick after it, under the rules above.
 * - A schedule paused tonight (`pausedUntil`) skips each cron time
 *   before that moment (`ScheduleSkipped`), then fires as before. The
 *   pause lives in the schedule in the flow document, so it survives a
 *   restart and reaches the Host that fires it from any Device.
 * - Run now (`runNow`) starts the schedule's run at once, as if it fired
 *   now: the same flow, inputs, base ref, stop time, Device and Person,
 *   with the schedule as its trigger (`at` is now). It refuses while an
 *   earlier run of the schedule is still open, as a cron time skips.
 */

/**
 * The morning a pause tonight lasts until, on the schedule's clock.
 *
 * The rule: Pause tonight skips the schedule's next start and every
 * start after it until the first 06:00 after that next start. So a
 * 22:00 schedule paused at noon skips 22:00 and fires again the next
 * evening. An hourly one paused at 23:00 skips 00:00 to 05:00 and fires
 * at 06:00. It always skips at least the next start, also of a schedule
 * that runs in the day.
 */
export const PAUSE_TONIGHT_UNTIL = "06:00";

/** When a pause tonight ends for a schedule whose next start is `nextStart`. */
export function pauseTonightEnds(
	nextStart: number,
	timeZone?: string,
): number | null {
	return nextTimeOfDay(PAUSE_TONIGHT_UNTIL, nextStart, timeZone);
}

/** Whether the schedule is paused at `at`: its pause has not ended. */
export function pausedAt(schedule: Schedule, at: number): boolean {
	return schedule.pausedUntil !== undefined && schedule.pausedUntil > at;
}

/**
 * How late any cron time may still start, also one from before the
 * schedule was watched. A missed time may start as late as the schedule's
 * `lateMinutes`, and no later than those minutes when they are fewer.
 */
export const SCHEDULE_GRACE_MS = 15 * 60_000;

/** A cron time that was missed by more than its schedule allows: it did not start. */
export type MissedScheduleTime = {
	projectId: string;
	scheduleId: string;
	/** The flow it would have started. */
	flow: string;
	/** The cron time (epoch ms). */
	at: number;
	/** The schedule's clock, when it names one. */
	timeZone?: string;
};

/** A missed cron time, with the Space of its project: what the notifier tells. */
export type ScheduleMissed = MissedScheduleTime & { spaceId: string };
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
		deps.usage?.note({ kind: "schedule-skipped", reason });
		record(projectId, scheduleId, { kind: "skipped", at, reason, runId });
	}

	/**
	 * What the due time `due` of a schedule does at `at`, when no earlier
	 * fact handled it: it starts, it was missed by more than the schedule
	 * allows, or it is ignored (it fell before the schedule was watched).
	 * Within the grace any time starts. Later, only a time that was missed:
	 * one this scheduler watched come due, or one that fell while the
	 * daemon was down for a schedule with history. It starts while it is
	 * within the schedule's `lateMinutes`.
	 */
	function timingOf(
		key: string,
		schedule: Schedule,
		due: number,
		at: number,
		current: History | undefined,
	): "start" | "missed" | "ignore" {
		const late = at - due;
		const window = lateMinutesOf(schedule) * 60_000;
		if (late <= Math.min(SCHEDULE_GRACE_MS, window)) return "start";
		const watched = watchedSince.get(key) ?? at;
		const missedWhileWatching = due >= watched;
		const missedWhileDown = current !== undefined && due < startedAt;
		if (!missedWhileWatching && !missedWhileDown) return "ignore";
		return late <= window ? "start" : "missed";
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

		const timing = timingOf(key, schedule, due, at, current);
		if (timing === "ignore") return;
		if (timing === "missed") {
			const late = at - due;
			await skip(
				projectId,
				schedule.id,
				due,
				`Missed by ${lateness(late)}. Night Shift was off, or the computer was asleep. This schedule starts at most ${lateness(lateMinutesOf(schedule) * 60_000)} late.`,
			);
			try {
				deps.missed?.({
					projectId,
					scheduleId: schedule.id,
					flow: schedule.flow,
					at: due,
					...(schedule.timeZone ? { timeZone: schedule.timeZone } : {}),
				});
			} catch (error) {
				console.error(
					`[schedules] ${schedule.id}: telling of a miss failed`,
					error,
				);
			}
			return;
		}

		if (schedule.pausedUntil !== undefined && due < schedule.pausedUntil) {
			await skip(
				projectId,
				schedule.id,
				due,
				"You paused this schedule for tonight.",
			);
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
		if (runId) deps.usage?.note({ kind: "schedule-fired" });
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
		async runNow(projectId, schedule, personId) {
			const { flow } = schedule;
			if (flow === undefined) {
				throw new Refusal("invalid", "This schedule starts no flow.");
			}
			await refresh();
			const open = await openRun(history.get(keyOf(projectId, schedule.id)));
			if (open) {
				throw new Refusal(
					"conflict",
					`An earlier run of this schedule is still ${open.status}. Wait for it to end, or stop it.`,
				);
			}
			const at = now();
			const stopAt = schedule.stopAt
				? (nextTimeOfDay(schedule.stopAt, at, schedule.timeZone) ?? undefined)
				: undefined;
			const startedBy = schedule.person ?? personId ?? undefined;
			const run = await deps.startRun(
				{
					projectId,
					flowName: flow,
					inputs: schedule.inputs,
					...(schedule.baseRef ? { baseRef: schedule.baseRef } : {}),
					...(stopAt !== undefined ? { stopAt } : {}),
					...(startedBy ? { startedBy } : {}),
				},
				{ kind: "schedule", scheduleId: schedule.id, at },
			);
			// A cron time before now counts as handled: it does not fire as well.
			await deps.log.append({
				type: "ScheduleFired",
				payload: {
					projectId,
					scheduleId: schedule.id,
					at,
					runId: run.id,
					error: null,
				},
			});
			record(projectId, schedule.id, { kind: "fired", at, runId: run.id });
			return run;
		},
		nextAt(projectId, schedule, at) {
			const { cron } = schedule;
			if (!schedule.enabled || cron === undefined || schedule.webhook) {
				return null;
			}
			if (pausedAt(schedule, at) && schedule.pausedUntil !== undefined) {
				// The first cron time at or after the pause ends.
				return (
					nextCronTimes(
						cron,
						schedule.pausedUntil - 1,
						1,
						schedule.timeZone,
					)[0] ?? null
				);
			}
			const due = latestCronTime(cron, at, schedule.timeZone);
			const current = history.get(keyOf(projectId, schedule.id));
			if (
				due !== null &&
				(!current || due > current.lastAt) &&
				timingOf(keyOf(projectId, schedule.id), schedule, due, at, current) ===
					"start"
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

/** A schedule's pause tonight after a change, and its next start with it. */
export type SchedulePause = {
	/** When the pause ends (epoch ms). Null: not paused. */
	pausedUntil: number | null;
	/** The next start (epoch ms), after the pause. Null when off. */
	nextAt: number | null;
};

export type ScheduleList = {
	/** Where the schedules are. */
	path: string;
	schedules: ScheduleSummary[];
	/** Problems of the whole file, for example JSON that does not parse. */
	issues: ScheduleIssue[];
};
