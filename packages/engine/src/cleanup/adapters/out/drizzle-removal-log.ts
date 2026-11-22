import type { Database } from "@nightshift/db";
import { type RunLog, worktreeRemovals } from "../../../log";
import type { RemovalLog } from "../../application/ports";

/**
 * `RemovalLog` over the event log: a removal is appended through the run
 * log as `WorktreeRemoved`, a fact of this computer with no run. The read
 * is the log's own query of a project's removals (`worktreeRemovals`).
 * `wireCleanup` builds it.
 */
export function drizzleRemovalLog(deps: {
	db: Database;
	log: Pick<RunLog, "append">;
}): RemovalLog {
	return {
		async removed(removal) {
			await deps.log.append({ type: "WorktreeRemoved", payload: removal });
		},
		async removals(projectId) {
			const removals = await worktreeRemovals(deps.db, projectId);
			return removals.map((removal) => ({
				at: removal.at,
				runId: removal.payload.runId,
				by: removal.payload.by,
			}));
		},
	};
}
