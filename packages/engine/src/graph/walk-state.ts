import type { Database } from "@nightshift/db";
import { lgCheckpoint, lgWrite } from "@nightshift/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { WalkFile, WalkFiles, WalkRef } from "../contract";
import {
	ForeignRowsError,
	type RunHistory,
	type RunLog,
	stepIdsOfRun,
} from "../log";

/*
 * A run's walk state as files: its latest Checkpoint and each step's
 * transcript and command log. A run that moves takes them to its new
 * Walker, and the readers of a run walked elsewhere open them. The engine
 * writes and reads them. The archive of `@nightshift/devices` keeps and
 * carries them, and never sees the checkpoint tables.
 */

/** The walk state of this computer's runs: what the peers read (`WalkFiles`), and the import of a run moved here. */
export type RunWalks = WalkFiles & {
	/**
	 * Writes the Checkpoint of a run another Device moved here (the content
	 * of its `checkpoint` file) into the checkpoint tables: what this
	 * computer resumes the run from. Rows it has already are kept, so a
	 * second import changes nothing. A Checkpoint with a row of another run
	 * is refused whole (`ForeignRowsError`).
	 */
	importWalk(runId: string, checkpoint: string): Promise<void>;
};

export function createRunWalks(deps: {
	db: Database;
	log: Pick<RunLog, "walkerId">;
	history: Pick<RunHistory, "runOwner" | "ownStepFiles">;
}): RunWalks {
	const { db, log, history } = deps;

	/** The run's Space when this computer walks it, else null. */
	async function ownSpace(runId: string): Promise<string | null> {
		const owner = await history.runOwner(runId);
		if (!owner || owner.walkerId !== (await log.walkerId())) return null;
		return owner.spaceId;
	}

	async function exportWalk(
		runId: string,
		options: { steps?: readonly string[] } = {},
	): Promise<WalkFile[]> {
		const spaceId = await ownSpace(runId);
		if (spaceId === null) return [];
		const self = await log.walkerId();
		const { steps } = options;
		const files: WalkFile[] = [];
		for (const stepId of await stepIdsOfRun(db, runId)) {
			if (steps && !steps.includes(stepId)) continue;
			const own = await history.ownStepFiles(stepId, self);
			if (!own) continue;
			const at = { spaceId, runId, stepId };
			if (own.transcript !== null) {
				files.push({
					ref: { kind: "transcript", ...at },
					content: own.transcript,
				});
			}
			if (own.log !== null) {
				files.push({ ref: { kind: "log", ...at }, content: own.log });
			}
		}
		files.push({
			ref: { kind: "checkpoint", spaceId, runId },
			content: await checkpointSnapshot(db, runId),
		});
		return files;
	}

	async function ownFile(ref: WalkRef): Promise<string | null> {
		if ((await ownSpace(ref.runId)) === null) return null;
		if (ref.kind === "checkpoint") return checkpointSnapshot(db, ref.runId);
		const own = await history.ownStepFiles(ref.stepId, await log.walkerId());
		if (!own || own.runId !== ref.runId) return null;
		return ref.kind === "log" ? own.log : own.transcript;
	}

	async function importWalk(runId: string, checkpoint: string): Promise<void> {
		const {
			runId: of,
			checkpoints,
			writes,
		} = JSON.parse(checkpoint) as CheckpointFile;
		const rows = [...checkpoints, ...writes];
		if (of !== runId || rows.some((r) => r.threadId !== runId)) {
			throw new ForeignRowsError(
				"The checkpoint is not of this run. Nothing was written.",
			);
		}
		const buffer = (value: string | null) =>
			value === null ? null : Buffer.from(value, "base64");
		await db.transaction(async (tx) => {
			for (const c of checkpoints) {
				await tx
					.insert(lgCheckpoint)
					.values({
						...c,
						checkpoint: buffer(c.checkpoint),
						metadata: buffer(c.metadata),
					})
					.onConflictDoNothing();
			}
			for (const w of writes) {
				await tx
					.insert(lgWrite)
					.values({ ...w, value: buffer(w.value) })
					.onConflictDoNothing();
			}
		});
	}

	return { exportWalk, ownFile, importWalk };
}

/**
 * The run's latest checkpoint per namespace and their pending writes, as
 * JSON (the blobs in base64): what a resume elsewhere needs. Replicas of
 * older versions read this format too: keep it as it is.
 */
async function checkpointSnapshot(
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

/** The `checkpoint` file of a run: its rows, the blobs in base64. */
type CheckpointFile = {
	runId: string;
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
