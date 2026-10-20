import type { Database } from "@nightshift/db";
import { run } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";

/**
 * The run's row: what a run is beside its event log (its project, flow
 * snapshot, worktree and Device).
 */

export type RunRow = typeof run.$inferSelect;

/** The run's row, or an error naming the run. */
export async function getRunRow(db: Database, runId: string): Promise<RunRow> {
	const [row] = await db.select().from(run).where(eq(run.id, runId));
	if (!row) throw new Error(`Run not found: ${runId}`);
	return row;
}
