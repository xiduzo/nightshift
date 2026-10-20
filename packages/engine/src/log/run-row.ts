import type { Database } from "@nightshift/db";
import { run, step } from "@nightshift/db/schema";
import { eq } from "drizzle-orm";

/**
 * The run's row: what a run is beside its event log (its project, flow
 * snapshot, worktree and Device), and the rows of its steps.
 */

export type RunRow = typeof run.$inferSelect;

/** The run's row, or an error naming the run. */
export async function getRunRow(db: Database, runId: string): Promise<RunRow> {
	const [row] = await db.select().from(run).where(eq(run.id, runId));
	if (!row) throw new Error(`Run not found: ${runId}`);
	return row;
}

/** Whether this Replica has the run's row. */
export async function hasRunRow(db: Database, runId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: run.id })
		.from(run)
		.where(eq(run.id, runId));
	return row !== undefined;
}

/** The ids of the project's runs. */
export async function runIdsOfProject(
	db: Database,
	projectId: string,
): Promise<string[]> {
	const rows = await db
		.select({ id: run.id })
		.from(run)
		.where(eq(run.projectId, projectId));
	return rows.map((r) => r.id);
}

/** The ids of the runs a Device walks. */
export async function runIdsWalkedBy(
	db: Database,
	walkerId: string,
): Promise<string[]> {
	const rows = await db
		.select({ id: run.id })
		.from(run)
		.where(eq(run.walkerId, walkerId));
	return rows.map((r) => r.id);
}

/** The ids of the run's steps. */
export async function stepIdsOfRun(
	db: Database,
	runId: string,
): Promise<string[]> {
	const rows = await db
		.select({ id: step.id })
		.from(step)
		.where(eq(step.runId, runId));
	return rows.map((s) => s.id);
}
