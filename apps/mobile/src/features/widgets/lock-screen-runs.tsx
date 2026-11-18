import { createRunQueries } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { useHostQueries } from "@/features/host";
import { syncFollowedRun, useFollowedRuns } from "./use-lock-screen";

/**
 * Keeps each followed run on the lock screen up to date while the app
 * runs, and ends it when the run ends. Renders nothing. The live cache
 * reads a run again when a step starts or ends, or the run sleeps, stops
 * or ends. While the app is in the background the phone stops it; the run
 * catches up when the app opens again.
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
	const run = useQuery(runQueries.get(runId));
	useEffect(() => {
		if (run.data) syncFollowedRun(runId, run.data);
	}, [runId, run.data]);
	return null;
}
