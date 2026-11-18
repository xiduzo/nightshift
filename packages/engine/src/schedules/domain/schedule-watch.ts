import {
	lateMinutesOf,
	latestCronTime,
	nextCronTimes,
	type Schedule,
} from "@nightshift/flows";
import { pausedAt } from "./pause-tonight";
import { type ScheduleHistory, scheduleKey } from "./schedule-history";

/**
 * The watch of the scheduler: what a due cron time of a schedule does.
 * The scheduler lives inside the engine and looks on an interval (and
 * once at start). Each look reads every project's schedules again, so an
 * edit applies without a restart.
 *
 * Durable rules, all derived from the event log (`ScheduleHistory`):
 * - A cron time fires at most once. The latest handled cron time of each
 *   schedule comes from the fired and skipped facts and the trigger of a
 *   run's start (which closes the gap when the daemon dies between the
 *   start and its fired fact).
 * - Only the latest due cron time counts. It fires when it is at most
 *   `SCHEDULE_GRACE_MS` late, for example after a daemon restart. A time
 *   that was missed fires up to the schedule's own `lateMinutes` late
 *   (default 15): one the watch saw come due (the computer slept), or one
 *   that fell while the daemon was down for a schedule that fired or was
 *   skipped before. Its run's trigger keeps the cron time, so the run
 *   knows when it was due (`{{run.due_at}}`). Later than that window a
 *   missed time is skipped and the people of the Space hear of it. A time
 *   from before a schedule existed or was resumed is ignored without a
 *   log entry.
 * - A schedule does not start while an earlier run of it is still running,
 *   waiting or sleeping: that cron time is skipped (`open-run.ts`).
 * - A start that fails (flow errors, the run cap) is recorded with its error
 *   and not retried.
 * - A hold (while a merge of Spaces moves rows) skips the looks and
 *   changes nothing else: a cron time that came due meanwhile fires on
 *   the first look after it, under the rules above.
 * - A schedule paused tonight (`pausedUntil`) skips each cron time before
 *   that moment, then fires as before (`pause-tonight.ts`).
 * - Run now starts the schedule's run at once, as if it fired now: the
 *   same flow, inputs, base ref, stop time, Device and Person, with the
 *   schedule as its trigger (`at` is now). It refuses while an earlier run
 *   of the schedule is still open, as a cron time skips.
 *
 * The watch keeps what the log does not: when the scheduler began, since
 * when it sees each schedule, and since when it is switched on. It is in
 * memory by design: a restart begins a new watch.
 */

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

/** A schedule the cron line starts: one with a cron line and a flow, and no webhook. */
export type CronSchedule = Schedule & { cron: string; flow: string };

/**
 * The schedule as one its cron line starts, or null: it is off, it has no
 * cron line or no flow, or a webhook starts it.
 */
export function cronScheduleOf(schedule: Schedule): CronSchedule | null {
	const { cron, flow } = schedule;
	if (
		cron === undefined ||
		flow === undefined ||
		schedule.webhook !== undefined ||
		!schedule.enabled
	) {
		return null;
	}
	return { ...schedule, cron, flow };
}

/** What the latest due cron time of a schedule does now. */
export type DueDecision =
	/** No due time, one that is handled already, one that came due while the scheduler was off, or one from before the schedule was watched. */
	| { kind: "none" }
	/** Missed by more than the schedule allows: it is skipped, and the Space hears of it. */
	| { kind: "missed"; due: number; reason: string; missed: MissedScheduleTime }
	/** Paused tonight: it is skipped. */
	| { kind: "paused"; due: number; reason: string }
	/** It starts, unless an earlier run of the schedule is still open. */
	| { kind: "start"; due: number };

export type ScheduleWatch = {
	/** The scheduler is switched off. Off counts as paused: on again, it starts from then. */
	switchedOff(): void;
	/** The scheduler is on at `at`. After it was off, a cron time before `at` neither fires nor counts as missed. */
	switchedOn(at: number): void;
	/** A look at `at` saw the schedule. The first one counts. */
	watch(projectId: string, scheduleId: string, at: number): void;
	/** The schedule is not one the cron line starts here: it is forgotten. */
	unwatch(projectId: string, scheduleId: string): void;
	/** What the latest due cron time of the schedule does at `at`. */
	decide(
		projectId: string,
		schedule: CronSchedule,
		at: number,
		history: ScheduleHistory | undefined,
	): DueDecision;
	/**
	 * The next start: a due time that still starts on the next look, else
	 * the next cron time. Paused tonight: the first cron time at or after
	 * the pause ends. Null when off.
	 */
	nextStart(
		projectId: string,
		schedule: Schedule,
		at: number,
		history: ScheduleHistory | undefined,
	): number | null;
};

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

/**
 * A new watch. `startedAt` is when the scheduler began: a cron time
 * before it fell while the daemon was down.
 */
export function createScheduleWatch(startedAt: number): ScheduleWatch {
	/** The first look that saw each enabled schedule. Forgotten while it is paused. */
	const watchedSince = new Map<string, number>();
	/** Whether the last look found the scheduler switched off. */
	let off = false;
	/** The first look after the scheduler was switched on again: a cron time before it neither fires nor counts as missed. */
	let onSince: number | null = null;

	/**
	 * What the due time `due` of a schedule does at `at`, when no earlier
	 * fact handled it: it starts, it was missed by more than the schedule
	 * allows, or it is ignored (it fell before the schedule was watched).
	 * Within the grace any time starts. Later, only a time that was missed:
	 * one this watch saw come due, or one that fell while the daemon was
	 * down for a schedule with history. It starts while it is within the
	 * schedule's `lateMinutes`.
	 */
	function timingOf(
		key: string,
		schedule: Schedule,
		due: number,
		at: number,
		current: ScheduleHistory | undefined,
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

	return {
		switchedOff() {
			watchedSince.clear();
			off = true;
		},
		switchedOn(at) {
			if (!off) return;
			off = false;
			onSince = at;
		},
		watch(projectId, scheduleId, at) {
			const key = scheduleKey(projectId, scheduleId);
			if (!watchedSince.has(key)) watchedSince.set(key, at);
		},
		unwatch(projectId, scheduleId) {
			watchedSince.delete(scheduleKey(projectId, scheduleId));
		},
		decide(projectId, schedule, at, history) {
			const key = scheduleKey(projectId, schedule.id);
			const due = latestCronTime(schedule.cron, at, schedule.timeZone);
			if (due === null) return { kind: "none" };
			if (history && due <= history.lastAt) return { kind: "none" };
			// It came due while the scheduler was off.
			if (onSince !== null && due < onSince) return { kind: "none" };

			const timing = timingOf(key, schedule, due, at, history);
			if (timing === "ignore") return { kind: "none" };
			if (timing === "missed") {
				return {
					kind: "missed",
					due,
					reason: `Missed by ${lateness(at - due)}. Night Shift was off, or the computer was asleep. This schedule starts at most ${lateness(lateMinutesOf(schedule) * 60_000)} late.`,
					missed: {
						projectId,
						scheduleId: schedule.id,
						flow: schedule.flow,
						at: due,
						...(schedule.timeZone ? { timeZone: schedule.timeZone } : {}),
					},
				};
			}
			if (schedule.pausedUntil !== undefined && due < schedule.pausedUntil) {
				return {
					kind: "paused",
					due,
					reason: "You paused this schedule for tonight.",
				};
			}
			return { kind: "start", due };
		},
		nextStart(projectId, schedule, at, history) {
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
			if (
				due !== null &&
				(!history || due > history.lastAt) &&
				timingOf(
					scheduleKey(projectId, schedule.id),
					schedule,
					due,
					at,
					history,
				) === "start"
			) {
				return due;
			}
			return nextCronTimes(cron, at, 1, schedule.timeZone)[0] ?? null;
		},
	};
}
