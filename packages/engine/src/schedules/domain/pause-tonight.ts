import { nextTimeOfDay, type Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";

/**
 * Pause tonight: a schedule skips its next start and every start after it
 * until the morning. The pause lives in the schedule (`pausedUntil`), so
 * it survives a restart and reaches the Host that fires it from any
 * Device.
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

/** The schedule without its pause. */
export function withoutPause(schedule: Schedule): Schedule {
	const { pausedUntil: _pause, ...rest } = schedule;
	return rest;
}

/** The schedule without a pause that has ended: a past `pausedUntil` means nothing. */
export function withoutEndedPause(schedule: Schedule, at: number): Schedule {
	if (schedule.pausedUntil === undefined || pausedAt(schedule, at)) {
		return schedule;
	}
	const { pausedUntil: _ended, ...rest } = schedule;
	return rest;
}

/**
 * The schedule paused tonight, when its next start without a pause is
 * `nextStart`. Refuses (`invalid`) a schedule that is off, has a webhook,
 * or has no next start.
 */
export function pausedTonight(
	schedule: Schedule,
	nextStart: number | null,
): Schedule {
	if (nextStart === null) {
		throw new Refusal(
			"invalid",
			!schedule.enabled
				? "This schedule is off. It starts nothing tonight."
				: schedule.webhook
					? "This schedule starts on a webhook. It has no times to pause."
					: "This schedule has no next start to pause.",
		);
	}
	const until = pauseTonightEnds(nextStart, schedule.timeZone);
	if (until === null) {
		throw new Refusal("invalid", "This schedule has no next start to pause.");
	}
	return { ...schedule, pausedUntil: until };
}

/** A schedule's pause tonight after a change, and its next start with it. */
export type SchedulePause = {
	/** When the pause ends (epoch ms). Null: not paused. */
	pausedUntil: number | null;
	/** The next start (epoch ms), after the pause. Null when off. */
	nextAt: number | null;
};
