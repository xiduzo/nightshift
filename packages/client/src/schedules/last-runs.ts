import { hasEnded, type RunSummary } from "../runs";

/** The last runs a schedule started, newest first, and how many of the ended ones finished. */
export type ScheduleLastRuns = {
	runs: RunSummary[];
	ended: number;
	finished: number;
};

/**
 * The newest `count` runs of `runs` that the schedule started, at its
 * cron times or on a webhook. `runs` is newest first, as the run list
 * sends it.
 */
export function scheduleLastRuns(
	runs: readonly RunSummary[],
	scheduleId: string,
	count: number,
): ScheduleLastRuns {
	const own = runs
		.filter(
			(run) =>
				run.trigger.kind !== "manual" && run.trigger.scheduleId === scheduleId,
		)
		.slice(0, count);
	const ended = own.filter((run) => hasEnded(run.status));
	return {
		runs: own,
		ended: ended.length,
		finished: ended.filter((run) => run.status === "finished").length,
	};
}
