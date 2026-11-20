import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { sha256OfFile } from "../archive";

/**
 * One look at a folder: which files count, as they are now, and what
 * differs from what a caller last knew. Which paths count, and which of
 * them a person or an agent reads, the caller says (`FolderPaths`). The
 * knowledge's reconcile, `INDEX.md` and search index ask this module, so
 * "changed" has one definition: a file
 * changed when its size or its time differ. A caller that must be sure asks
 * for the hash, which is read once per snapshot. An edit that keeps both
 * size and time is not seen. That is a choice: reading each file at each step
 * costs more than it finds.
 *
 * A snapshot is true for the moment of its scan. Scan again for a later
 * question, and never keep one: a reconcile writes the folder, so a step
 * scans again after it.
 *
 * Each caller keeps its own record to compare with, because they answer
 * different questions. `.reconciled.json` says what this folder last agreed
 * with the document: it is the merge's base, and a path missing from it is
 * new, so it travels again to every Device. The `files` table of
 * `.search.sqlite` says what the index last read. That file is a cache
 * anyone may delete, and a new `SCHEMA_VERSION` deletes it. Were it the
 * merge's base, each rebuild would bring back files that another Device
 * removed. And a crash between a reconcile and a refresh recovers because
 * each record moves only when its own work is done.
 */

/** One file of a look at a folder. */
export type FolderFile = {
	/** Relative to the folder, with `/` between its parts. */
	path: string;
	/** Bytes. */
	size: number;
	/** Epoch ms: the file's time of change. */
	changedAt: number;
};

/** Which paths of a folder count, and which of them a person or an agent reads. */
export type FolderPaths = {
	/** A path that counts. A folder counts when `<folder>/x` does. */
	counts(path: string): boolean;
	/** A path that counts and that a person or an agent reads. */
	readable(path: string): boolean;
};

/** A file as a caller last knew it. */
export type FileStamp = { size: number; mtimeMs: number };

/** What differs from a caller's record. */
type FolderChanges<Stamp> = {
	/** Files that are new, or whose size or time differ, by path. */
	changed: ReadonlyMap<string, FolderFile>;
	/** What the record has and the folder has not. */
	gone: Stamp[];
};

export type FolderSnapshot = {
	/** The folder this is a look at. */
	dir: string;
	/** Every file that counts (`counts`), no link, in walk order. */
	files: readonly FolderFile[];
	/** The files a person or an agent reads (`readable`), at most 20 000. */
	readable: readonly FolderFile[];
	/** The newest change among `readable` and their folders: a file that went changes its folder. */
	newestReadable: number;
	/** One file of `files`, by its path. */
	file(path: string): FolderFile | undefined;
	/** What differs from `base`, among `files` unless given fewer. */
	changedSince<Stamp extends FileStamp>(
		base: ReadonlyMap<string, Stamp>,
		among?: readonly FolderFile[],
	): FolderChanges<Stamp>;
	/** A file's hash, read at the first question. Null when it cannot be read. */
	sha256(path: string): Promise<string | null>;
};

/** The most files `readable` holds: a folder past it is far too large to read. */
const MAX_READABLE = 20_000;

/** The folder `dir` as it is now. No folder there: a snapshot with no files. */
export async function snapshotFolder(
	dir: string,
	paths: FolderPaths,
): Promise<FolderSnapshot> {
	const files: FolderFile[] = [];
	const readable: FolderFile[] = [];
	let newestReadable = 0;
	const visit = async (abs: string, rel: string): Promise<void> => {
		const names = await readdir(abs).catch(() => null);
		if (!names) return;
		names.sort();
		// All at once: one by one, a walk of 2 000 files takes six times as long.
		const infos = await Promise.all(
			names.map((name) => lstat(join(abs, name)).catch(() => null)),
		);
		for (const [i, info] of infos.entries()) {
			if (!info) continue;
			const name = names[i] as string;
			const path = rel === "" ? name : `${rel}/${name}`;
			if (info.isDirectory()) {
				// A folder whose files would all be left out is not walked.
				if (!paths.counts(`${path}/x`)) continue;
				if (paths.readable(`${path}/x`) && readable.length < MAX_READABLE) {
					newestReadable = Math.max(newestReadable, info.mtimeMs);
				}
				await visit(join(abs, name), path);
			} else if (info.isFile() && paths.counts(path)) {
				const file = { path, size: info.size, changedAt: info.mtimeMs };
				files.push(file);
				if (paths.readable(path) && readable.length < MAX_READABLE) {
					readable.push(file);
					newestReadable = Math.max(newestReadable, info.mtimeMs);
				}
			}
		}
	};
	await visit(dir, "");

	const byPath = new Map(files.map((file) => [file.path, file]));
	const hashes = new Map<string, Promise<string | null>>();
	return {
		dir,
		files,
		readable,
		newestReadable,
		file: (path) => byPath.get(path),
		changedSince<Stamp extends FileStamp>(
			base: ReadonlyMap<string, Stamp>,
			among: readonly FolderFile[] = files,
		) {
			const changed = new Map<string, FolderFile>();
			const seen = new Set<string>();
			for (const file of among) {
				seen.add(file.path);
				const known = base.get(file.path);
				if (
					!known ||
					known.size !== file.size ||
					known.mtimeMs !== file.changedAt
				) {
					changed.set(file.path, file);
				}
			}
			const gone = [...base].flatMap(([path, known]) =>
				seen.has(path) ? [] : [known],
			);
			return { changed, gone };
		},
		sha256(path) {
			let hash = hashes.get(path);
			if (!hash) {
				hash = sha256OfFile(join(dir, ...path.split("/"))).catch(() => null);
				hashes.set(path, hash);
			}
			return hash;
		},
	};
}
