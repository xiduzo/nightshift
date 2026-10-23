import type { RunStatus } from "@nightshift/client";

import { StatusBadge } from "@/shared/status";
import { runStatusLook } from "@/shared/tone";

/** The status of a run, with its icon and color, as the web shows it. */
export function RunStatusBadge({ status }: { status: RunStatus }) {
	return <StatusBadge look={runStatusLook(status)} />;
}
