import type { ScheduleSummary } from "./types";

/**
 * Whether the schedule is paused tonight at `now`: Pause tonight skips
 * its starts until `pausedUntil` (the first 06:00 after its next start,
 * on its clock). A list read before the pause ended still carries it,
 * so a screen asks with its own clock.
 */
export function isPausedTonight(
	schedule: Pick<ScheduleSummary, "pausedUntil">,
	now: number,
): boolean {
	return schedule.pausedUntil !== undefined && schedule.pausedUntil > now;
}
