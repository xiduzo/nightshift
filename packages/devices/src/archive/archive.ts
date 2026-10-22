import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type CopyStamp, stampHolds } from "@nightshift/engine";
import type { ArchiveRef } from "../contract";

/**
 * The archive: the walk state of runs walked elsewhere, per Space. When a
 * node ends, its Walker copies the step's transcript and command log, and
 * the run's latest Checkpoint, to its Host (`archive.put`). The engine
 * writes and reads those files (`WalkFiles`); the archive only keeps and
 * carries them. A Replica that opens a transcript of a run another Device
 * walks reads it here, and fetches it from the Host on demand when it
 * lacks it (`archive.get`), keeping the copy. The Host's own runs are
 * served from their own files.
 *
 * Layout, the same on a Host and as a Device's cache:
 * `<data dir>/archive/<space>/<run>/<step>.ndjson`, `<step>.log` and
 * `checkpoint.json`. A step's file has its stamp beside it
 * (`<step>.ndjson.stamp`): which end of the step it holds. Retention is
 * undecided, as it is for run history: everything is kept.
 */

export function archivePath(dataDir: string, ref: ArchiveRef): string {
	const dir = join(dataDir, "archive", ref.spaceId, ref.runId);
	if (ref.kind === "checkpoint") return join(dir, "checkpoint.json");
	return join(dir, `${ref.stepId}.${ref.kind === "log" ? "log" : "ndjson"}`);
}

/** Where a copy's stamp is kept: beside the copy. */
const stampPath = (dataDir: string, ref: ArchiveRef) =>
	`${archivePath(dataDir, ref)}.stamp`;

/** Writes a file whole: to a temporary file, then a rename. */
async function writeWhole(path: string, content: string) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, content);
	await rename(temporary, path);
}

/**
 * Writes one file of the archive whole, with the stamp of a step's file.
 * Without one (from a Walker of an older version) the copy has no stamp.
 * The content goes before its stamp, and an old stamp goes before the
 * content: a reader that reads the stamp first never takes a copy of an
 * earlier end for a later one.
 */
export async function writeArchive(
	dataDir: string,
	ref: ArchiveRef,
	content: string,
	stamp?: CopyStamp,
): Promise<void> {
	if (!stamp) await rm(stampPath(dataDir, ref), { force: true });
	await writeWhole(archivePath(dataDir, ref), content);
	if (stamp && ref.kind !== "checkpoint") {
		await writeWhole(stampPath(dataDir, ref), JSON.stringify(stamp));
	}
}

/** Removes one file of the archive. Nothing happens when this Replica has none. */
export async function dropArchive(
	dataDir: string,
	ref: ArchiveRef,
): Promise<void> {
	await rm(archivePath(dataDir, ref), { force: true });
	await rm(stampPath(dataDir, ref), { force: true });
}

/** One file of the archive, or null when this Replica has none. */
export async function readArchive(
	dataDir: string,
	ref: ArchiveRef,
): Promise<string | null> {
	return readOrNull(archivePath(dataDir, ref));
}

/**
 * This Replica's copy of a file for a reader that knows its step as
 * `known` (`PeerContext.stepStamp`): a step's file only when its stamp
 * holds that (`stampHolds`). A checkpoint has no stamp. Null otherwise.
 */
export async function readCopy(
	dataDir: string,
	ref: ArchiveRef,
	known: CopyStamp | null,
): Promise<string | null> {
	if (ref.kind !== "checkpoint") {
		const text = await readOrNull(stampPath(dataDir, ref));
		const stamp = text === null ? undefined : parseStamp(text);
		if (stamp === null || !stampHolds(stamp, known)) return null;
	}
	return readArchive(dataDir, ref);
}

/** A stamp as it was written, or null for one that is not valid: it holds nothing. */
function parseStamp(text: string): CopyStamp | null {
	try {
		const { opening, ended } = JSON.parse(text) as Partial<CopyStamp>;
		if (typeof opening === "number" && typeof ended === "boolean") {
			return { opening, ended };
		}
	} catch {
		// Not valid: below.
	}
	return null;
}

async function readOrNull(path: string): Promise<string | null> {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}
