import { ORPCError } from "@orpc/client";

import { startsOnTime } from "./plan";
import { isPausedTonight } from "./tonight";
import type { ScheduleList, ScheduleSummary } from "./types";

/**
 * What a person may nudge on a schedule from the phone, by its state.
 * Pause tonight needs a next start on a clock. Resume tonight needs a
 * pause. Run now needs a flow to start. The Host decides the rest (the
 * role, an earlier run that is still open).
 */
export function scheduleNudges(
	schedule: ScheduleSummary,
	now: number,
): { pause: boolean; resume: boolean; runNow: boolean } {
	const paused = isPausedTonight(schedule, now);
	return {
		pause: !paused && startsOnTime(schedule),
		resume: paused,
		runNow: schedule.flow !== undefined,
	};
}

/** What Pause tonight and Resume tonight answer: the pause, and the next start with it. */
export type SchedulePause = {
	pausedUntil: number | null;
	nextAt: number | null;
};

/**
 * The list with the answer of Pause tonight or Resume tonight in the
 * schedule: what the Host would send if it read the list again. Another
 * list stays as it is.
 */
export function withPause(
	list: ScheduleList,
	scheduleId: string,
	pause: SchedulePause,
): ScheduleList {
	return {
		...list,
		schedules: list.schedules.map((schedule) => {
			if (schedule.id !== scheduleId) return schedule;
			const { pausedUntil: _old, ...rest } = schedule;
			return {
				...rest,
				...(pause.pausedUntil !== null
					? { pausedUntil: pause.pausedUntil }
					: {}),
				nextAt: pause.nextAt,
			};
		}),
	};
}

/**
 * Why Pause tonight, Resume tonight or Run now did not work:
 *
 * - `host-outdated`: the Host does not know the procedure (an older Host
 *   answers a plain 404, not an error of its own).
 * - `busy`: an earlier run of the schedule is still open (CONFLICT).
 * - `refused`: the schedule cannot do it now: off, on a webhook, no next
 *   start (BAD_REQUEST).
 * - `forbidden`: the person's role does not allow it.
 * - `gone`: the schedule or its project is not there any more.
 * - `other`: anything else, such as a dropped connection.
 */
export type NudgeProblem =
	| "host-outdated"
	| "busy"
	| "refused"
	| "forbidden"
	| "gone"
	| "other";

/** Whether the error is the Host's 404 for a path it does not know: no error body of its own. */
function isUnknownProcedure(error: ORPCError<string, unknown>): boolean {
	const { data } = error;
	return (
		error.code === "NOT_FOUND" &&
		typeof data === "object" &&
		data !== null &&
		"status" in data &&
		"headers" in data
	);
}

/** The problem of an error of a schedule nudge. */
export function nudgeProblem(error: unknown): NudgeProblem {
	if (!(error instanceof ORPCError)) return "other";
	if (isUnknownProcedure(error)) return "host-outdated";
	switch (error.code) {
		case "CONFLICT":
			return "busy";
		case "BAD_REQUEST":
			return "refused";
		case "FORBIDDEN":
			return "forbidden";
		case "NOT_FOUND":
			return "gone";
		default:
			return "other";
	}
}
