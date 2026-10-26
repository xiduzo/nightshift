import type { RunResult, RunStatus } from "@nightshift/client";

import { StatusBadge } from "@/shared/status";
import { runStatusLook } from "@/shared/tone";

/** The status of a run, with its icon and color, as the web shows it. */
export function RunStatusBadge({
	status,
	result = null,
}: {
	status: RunStatus;
	/** The result of the End node that ended the run: "Nothing to do" shows as such. */
	result?: RunResult | null;
}) {
	return <StatusBadge look={runStatusLook(status, result)} />;
}
