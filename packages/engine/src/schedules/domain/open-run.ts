import type { RunStatus } from "../../run-status";
import type { ScheduleHistory } from "./schedule-history";

/**
 * The overlap rule: a schedule does not start while an earlier run of it
 * is still running, waiting or sleeping.
 */

/** How many of a schedule's latest runs the overlap check looks at. */
export const OVERLAP_LOOKBACK = 5;

const OPEN_STATUSES: readonly RunStatus[] = ["running", "waiting", "sleeping"];

/** An earlier run of a schedule that has not ended. */
export type OpenRun = { runId: string; status: RunStatus };

/**
 * An earlier run of the schedule that is still running, waiting or
 * sleeping: the newest of its last `OVERLAP_LOOKBACK` runs that is open.
 * `statusOf` gives a run's status now, or null when the run is gone.
 */
export async function openRunOf(
	history: ScheduleHistory | undefined,
	statusOf: (runId: string) => Promise<RunStatus | null>,
): Promise<OpenRun | null> {
	for (const runId of (history?.runIds ?? [])
		.slice(-OVERLAP_LOOKBACK)
		.reverse()) {
		const status = await statusOf(runId);
		if (status && OPEN_STATUSES.includes(status)) return { runId, status };
	}
	return null;
}

/** Why a cron time is skipped while `open` has not ended. Stored in the log and shown. */
export function openRunSkipWords(open: OpenRun): string {
	return `An earlier run of this schedule is still ${open.status}.`;
}

/** Why Run now is refused while `open` has not ended. */
export function openRunRefusalWords(open: OpenRun): string {
	return `An earlier run of this schedule is still ${open.status}. Wait for it to end, or stop it.`;
}
