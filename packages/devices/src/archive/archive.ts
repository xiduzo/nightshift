import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ArchiveRef } from "../contract";

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
