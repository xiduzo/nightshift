import type { Database } from "@nightshift/db";
import { lgCheckpoint, lgWrite } from "@nightshift/db/schema";
import { and, eq, sql } from "drizzle-orm";

/*
 * A run's LangGraph checkpoints as one JSON document, and back: what moves
 * with a run to a new Walker (`@nightshift/devices` keeps it in the
 * archive). The checkpoint tables stay the engine's own.
 */

/**
 * The run's latest checkpoint per namespace and their pending writes, as
 * JSON (the blobs in base64): what a resume elsewhere needs.
 */
export async function checkpointSnapshot(
	db: Database,
	runId: string,
): Promise<string> {
	const latest = sql`(select max(c.checkpoint_id) from ${lgCheckpoint} c where c.thread_id = ${lgCheckpoint.threadId} and c.checkpoint_ns = ${lgCheckpoint.checkpointNs})`;
	const checkpoints = await db
		.select()
		.from(lgCheckpoint)
		.where(
			and(
				eq(lgCheckpoint.threadId, runId),
				sql`${lgCheckpoint.checkpointId} = ${latest}`,
			),
		);
	const writes = [];
	for (const c of checkpoints) {
		writes.push(
			...(await db
				.select()
				.from(lgWrite)
				.where(
					and(
						eq(lgWrite.threadId, runId),
						eq(lgWrite.checkpointNs, c.checkpointNs),
						eq(lgWrite.checkpointId, c.checkpointId),
					),
				)),
		);
	}
	const base64 = (value: Buffer | null) => value?.toString("base64") ?? null;
	return JSON.stringify({
		runId,
		checkpoints: checkpoints.map((c) => ({
			...c,
			checkpoint: base64(c.checkpoint),
			metadata: base64(c.metadata),
		})),
		writes: writes.map((w) => ({ ...w, value: base64(w.value) })),
	});
}

/**
 * Writes a run's checkpoint snapshot (`checkpointSnapshot`) into this
 * Replica's checkpoint tables: what a new Walker resumes from. Rows it has
 * are kept.
 */
export async function restoreCheckpoint(
	db: Database,
	snapshot: string,
): Promise<void> {
	const parsed = JSON.parse(snapshot) as {
		checkpoints: (Omit<
			typeof lgCheckpoint.$inferInsert,
			"checkpoint" | "metadata"
		> & {
			checkpoint: string | null;
			metadata: string | null;
		})[];
		writes: (Omit<typeof lgWrite.$inferInsert, "value"> & {
			value: string | null;
		})[];
	};
	const buffer = (value: string | null) =>
		value === null ? null : Buffer.from(value, "base64");
	for (const c of parsed.checkpoints) {
		await db
			.insert(lgCheckpoint)
			.values({
				...c,
				checkpoint: buffer(c.checkpoint),
				metadata: buffer(c.metadata),
			})
			.onConflictDoNothing();
	}
	for (const w of parsed.writes) {
		await db
			.insert(lgWrite)
			.values({ ...w, value: buffer(w.value) })
			.onConflictDoNothing();
	}
}
