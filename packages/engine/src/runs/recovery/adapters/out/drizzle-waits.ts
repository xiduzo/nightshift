import type { Database } from "@nightshift/db";
import { event, run } from "@nightshift/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { type RunLog, type RunState, runIdsWalkedBy } from "../../../../log";
import type { Waits } from "../../application/ports";

/** What the sleeps of this computer's runs stand on. */
export type DrizzleWaitsDeps = {
	db: Database;
	log: Pick<RunLog, "walkerId" | "derive">;
};

/** The wait a run sleeps in, kept per run by the log until its next append. */
const sleepOf = (state: RunState) => state.sleep;

/** The sleeps of the runs this computer walks, over the engine's database and the run log. */
export function drizzleWaits(deps: DrizzleWaitsDeps): Waits {
	const { db, log } = deps;
	return {
		async sleeping() {
			const self = await log.walkerId();
			return log.derive(await runIdsWalkedBy(db, self), sleepOf);
		},
		async waitedFor(projectId, signal) {
			const walkerId = await log.walkerId();
			const rows = await db
				.selectDistinct({ runId: event.runId })
				.from(event)
				.innerJoin(run, eq(run.id, event.runId))
				.where(
					and(
						eq(event.type, "WaitStarted"),
						eq(run.projectId, projectId),
						eq(run.walkerId, walkerId),
						sql`json_extract(${event.payload}, '$.signal') = ${signal}`,
					),
				);
			return rows.flatMap((row) => (row.runId ? [row.runId] : []));
		},
	};
}
