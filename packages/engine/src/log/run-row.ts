import type { Database } from "@nightshift/db";
import { event, run, step } from "@nightshift/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { LoggedEvent } from "./events";

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

/** The Space of the run, or null when this Replica has no run of that id. */
export async function spaceOfRun(
	db: Database,
	runId: string,
): Promise<string | null> {
	const [row] = await db
		.select({ spaceId: run.spaceId })
		.from(run)
		.where(eq(run.id, runId));
	return row?.spaceId ?? null;
}

/** Whether this Replica has the run's row. */
export async function hasRunRow(db: Database, runId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: run.id })
		.from(run)
		.where(eq(run.id, runId));
	return row !== undefined;
}

/**
 * Applies `WalkerMoved` to the run rows: the run's Walker is the latest
 * `to`. A run from before Placement keeps its steps' Device: the Walker it
 * had.
 */
export async function applyWalkerMoves(
	db: Database,
	events: readonly LoggedEvent[],
): Promise<void> {
	const runIds = events.flatMap((e) =>
		e.type === "WalkerMoved" && e.runId ? [e.runId] : [],
	);
	if (runIds.length > 0) await followWalkerMoves(db, runIds);
}

/**
 * The statement that gives each of the runs the Walker its log names: the
 * `to` of its latest `WalkerMoved`. It reads the log, not the events that
 * just came, so it repeats safely: a run whose Walker already follows its
 * log is not touched. A run from before Placement keeps its steps'
 * Device: the Walker it had.
 */
export function followWalkerMoves(db: Database, runIds: readonly string[]) {
	const latestTo = sql<string>`(select json_extract(${event.payload}, '$.to') from ${event} where ${event.runId} = ${run.id} and ${event.type} = 'WalkerMoved' order by ${event.seq} desc limit 1)`;
	return db
		.update(run)
		.set({
			deviceId: sql`coalesce(${run.deviceId}, ${run.walkerId})`,
			walkerId: latestTo,
		})
		.where(
			and(
				inArray(run.id, [...runIds]),
				sql`${latestTo} is not null`,
				sql`${run.walkerId} is not ${latestTo}`,
			),
		);
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
