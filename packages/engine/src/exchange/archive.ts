import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Database } from "@nightshift/db";
import {
	lgCheckpoint,
	lgWrite,
	run,
	step,
} from "@nightshift/db/schema/nightshift";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { commandLogPath } from "../transcripts";

/**
 * The archive: the run state of runs walked elsewhere, per Space. When a
 * node ends, its Walker copies the step's transcript and command log, and
 * the run's latest LangGraph checkpoints, to its Host (`archive.put`). A
 * Replica that opens a transcript of a run another Device walks reads it
 * here, and fetches it from the Host on demand when it lacks it
 * (`archive.get`), keeping the copy. The Host's own runs are served from
 * their own files.
 *
 * Layout, the same on a Host and as a Device's cache:
 * `<data dir>/archive/<space>/<run>/<step>.ndjson`, `<step>.log` and
 * `checkpoint.json`. Retention is undecided, as it is for run history:
 * everything is kept.
 */

/** Ids that become path segments: no separators, no dots. */
const segment = z.string().regex(/^[\w-]{1,128}$/);

export const archiveRefSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.enum(["transcript", "log"]),
		spaceId: segment,
		runId: segment,
		stepId: segment,
	}),
	z.object({ kind: z.literal("checkpoint"), spaceId: segment, runId: segment }),
]);
/** One file of the archive. */
export type ArchiveRef = z.infer<typeof archiveRefSchema>;

export function archivePath(dataDir: string, ref: ArchiveRef): string {
	const dir = join(dataDir, "archive", ref.spaceId, ref.runId);
	if (ref.kind === "checkpoint") return join(dir, "checkpoint.json");
	return join(dir, `${ref.stepId}.${ref.kind === "log" ? "log" : "ndjson"}`);
}

/** Writes one file of the archive whole (a write to a temporary file, then a rename). */
export async function writeArchive(
	dataDir: string,
	ref: ArchiveRef,
	content: string,
): Promise<void> {
	const path = archivePath(dataDir, ref);
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, content);
	await rename(temporary, path);
}

/** One file of the archive, or null when this Replica has none. */
export async function readArchive(
	dataDir: string,
	ref: ArchiveRef,
): Promise<string | null> {
	try {
		return await readFile(archivePath(dataDir, ref), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

/**
 * A step this Replica walked, as files: its transcript and its command log
 * (null when it has none). Null for a step of a run walked elsewhere.
 */
export async function ownStepFiles(
	db: Database,
	dataDir: string,
	stepId: string,
	walkerId: string,
): Promise<{
	spaceId: string;
	runId: string;
	transcript: string | null;
	log: string | null;
} | null> {
	const [row] = await db
		.select({
			spaceId: step.spaceId,
			runId: step.runId,
			transcriptPath: step.transcriptPath,
			walkerId: run.walkerId,
		})
		.from(step)
		.innerJoin(run, eq(run.id, step.runId))
		.where(eq(step.id, stepId));
	if (!row || row.walkerId !== walkerId) return null;
	const read = async (path: string) =>
		existsSync(path) ? readFile(path, "utf8") : null;
	return {
		spaceId: row.spaceId,
		runId: row.runId,
		transcript: await read(row.transcriptPath),
		log: await read(commandLogPath(dataDir, row.runId, stepId)),
	};
}

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
