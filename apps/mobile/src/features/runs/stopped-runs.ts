import type { RunSummary } from "@nightshift/client";
import { now as timeNow } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSignedIn } from "@/features/host";
import { useLeftRuns } from "./left-runs";

/** The statuses of a run that ended before its work was done. */
const STOPPED = ["failed", "stopped", "interrupted"] as const;

/** How far back a run that stopped still needs you: one night and a morning. */
const STOPPED_WINDOW_MS = 24 * 60 * 60 * 1000;

/** At most this many: older ones wait in Runs. */
const LIMIT = 20;

/**
 * The runs that stopped in the last day and that you did not leave, the
 * newest end first. An End node that chose to fail the run counts too:
 * the person still decides what to do with it.
 */
export function stoppedRuns(
	runs: readonly RunSummary[],
	left: readonly string[],
	now: number,
): RunSummary[] {
	const leftIds = new Set(left);
	return runs
		.filter(
			(run) =>
				(STOPPED as readonly string[]).includes(run.status) &&
				!leftIds.has(run.id) &&
				(run.endedAt ?? run.createdAt) >= now - STOPPED_WINDOW_MS,
		)
		.sort((a, b) => (b.endedAt ?? b.createdAt) - (a.endedAt ?? a.createdAt));
}

/**
 * The runs of the Space that failed or stopped in the last day, without
 * the ones you left on this phone. Undefined while they load. The live
 * cache reads the list again when a run ends or starts again. A screen
 * passes `useWhileFocused().subscribed`: hidden, it does not render on a
 * change. The tab bar is no screen: it stays subscribed.
 */
export function useStoppedRuns(subscribed = true): {
	runs: RunSummary[] | undefined;
	error: Error | null;
	refetch: () => Promise<unknown>;
} {
	const { host } = useSignedIn();
	// Under `runs.list`: the live cache reads it again with every list of runs.
	const list = useQuery({
		...host.orpc.runs.list.queryOptions({
			input: { statuses: [...STOPPED], limit: LIMIT },
		}),
		meta: { quietRefetchErrors: true },
		subscribed,
	});
	const left = useLeftRuns();
	const page = list.data;
	const runs = useMemo(
		() => (page ? stoppedRuns(page, left, timeNow()) : undefined),
		[page, left],
	);
	return { runs, error: list.error, refetch: list.refetch };
}
