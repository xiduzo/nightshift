import type { Database } from "@nightshift/db";
import { type RunLog, worktreeRemovals } from "../../../../log";
import type { RemovalLog } from "../../application/ports";

/** The read of `RemovalLog`: the log's own query of a project's removals (`worktreeRemovals`). */
export function drizzleRemovals(db: Database): Pick<RemovalLog, "removals"> {
	return {
		async removals(projectId) {
			const removals = await worktreeRemovals(db, projectId);
			return removals.map((removal) => ({
				at: removal.at,
				runId: removal.payload.runId,
				by: removal.payload.by,
				kept: (removal.payload.kept?.length ?? 0) > 0,
				expired: (removal.payload.expired?.length ?? 0) > 0,
				copy: removal.payload.worktreePath !== null,
			}));
		},
	};
}

/**
 * `RemovalLog` over the event log: a removal is appended through the run
 * log as `WorktreeRemoved`, a fact of this computer with no run. The read
 * is `drizzleRemovals`. `wireCleanup` builds it.
 */
export function drizzleRemovalLog(deps: {
	db: Database;
	log: Pick<RunLog, "append">;
}): RemovalLog {
	return {
		async removed(removal) {
			await deps.log.append({ type: "WorktreeRemoved", payload: removal });
		},
		...drizzleRemovals(deps.db),
	};
}
