import { createRunQueries } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useHostQueries } from "@/features/host";
import { syncFollowedRun, useFollowedRuns } from "./use-lock-screen";

/** How often a followed run is read again while the app runs. */
const FOLLOW_POLL_MS = 5_000;

/**
 * Keeps each followed run on the lock screen up to date while the app
 * runs, and ends it when the run ends. Renders nothing. While the app is
 * in the background the phone stops it; the run catches up when the app
 * opens again.
 */
export function LockScreenRuns() {
	const runs = useFollowedRuns();
	return (
		<>
			{runs.map((run) => (
				<FollowedRun key={run.runId} runId={run.runId} />
			))}
		</>
	);
}

function FollowedRun({ runId }: { runId: string }) {
	const runQueries = useHostQueries(createRunQueries);
	const run = useQuery({
		...runQueries.get(runId),
		refetchInterval: FOLLOW_POLL_MS,
	});
	useEffect(() => {
		if (run.data) syncFollowedRun(runId, run.data);
	}, [runId, run.data]);
	return null;
}
