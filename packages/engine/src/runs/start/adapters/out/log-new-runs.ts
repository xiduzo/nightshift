import type { Database } from "@nightshift/db";
import { run } from "@nightshift/db/schema";
import { Refusal } from "@nightshift/refusal";
import { eq } from "drizzle-orm";
import { planColumns, type RunLog } from "../../../../log";
import type { NewRuns } from "../../application/ports";

/** What the new runs stand on: the database the run's row goes in, and the run log its events go in. */
export type LogNewRunsDeps = {
	db: Database;
	log: Pick<RunLog, "append" | "row" | "state">;
};

/**
 * The runs this computer starts, over the run log: the run's row and its
 * `RunStarted` go in as one batch of the log (`append` with the row's
 * insert `before` it), so a reader never sees a row without its event.
 */
export function logNewRuns(deps: LogNewRunsDeps): NewRuns {
	const { db, log } = deps;
	return {
		async started(started) {
			await log.append(
				{ type: "RunStarted", runId: started.id, payload: started.started },
				{
					before: [
						db.insert(run).values({
							id: started.id,
							spaceId: started.spaceId,
							projectId: started.projectId,
							flowName: started.flowName,
							flow: JSON.stringify(started.flow),
							bodyFlows: JSON.stringify(started.calledFlows),
							flowRevision: started.flowRevision,
							bodyFlowRevisions: JSON.stringify(started.calledFlowRevisions),
							title: started.title,
							worktreePath: started.worktreePath,
							branch: started.branch,
							baseRef: started.baseRef,
							walkerId: started.walkerId,
							// The walk reads the plan, and decides nothing again.
							...planColumns(started.plan),
						}),
					],
				},
			);
			const [row] = await db.select().from(run).where(eq(run.id, started.id));
			if (!row) throw new Error("Could not create the run.");
			return row;
		},
		async pinned(runId) {
			const row = await log.row(runId).catch((error: unknown) => {
				if (error instanceof Refusal && error.kind === "not-found") return null;
				throw error;
			});
			if (row === null) return null;
			return { run: row, state: await log.state(runId) };
		},
	};
}
