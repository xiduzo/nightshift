import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, realpath, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Refusal } from "@nightshift/refusal";

/**
 * Run folders (ADR 22): the folder a run of a project without a folder
 * works in, on each Device that runs one of its steps. One flat folder per
 * run in the data folder, `<dataDir>/run-folders/<runId>/`, like the
 * artifacts. It starts empty and has no git: what its steps write there
 * are the run's files. It does not move between Devices: each Device has
 * its own folder of the run.
 *
 * The run page lists its files and serves them to the Members of the
 * Space (`list`, `file`). Neither follows a link: a file is served only
 * when its real path is the path in the folder, so a link an agent made
 * never shows what is outside. `.git` stays hidden. The scheduled cleanup
 * removes the folders (`cleanup/`).
 */

export type RunFolders = ReturnType<typeof createRunFolders>;

/** The most entries (files and folders) one list of a run's folder walks. The list stops there. */
export const RUN_FILES_MAX = 1_000;

/** A file a run left in its folder. */
export type RunFile = {
	/** Its path in the run's folder, with `/` between folders: `report/summary.md`. */
	path: string;
	size: number;
	/** When it last changed. */
	modifiedAt: number;
};

/** The files of a run's folder on this computer, by path. */
export type RunFolderList = {
	files: RunFile[];
	/** The folder holds more than `RUN_FILES_MAX` entries: the list stops there. */
	more: boolean;
};

/** Why a path is not one of a file of the run's folder. */
export const NOT_A_RUN_FILE = "That is not a file of this run.";

/**
 * Why a Device makes no run folder: it runs an older Night Shift, which
 * does not know the call (or a test's Device, which has none).
 */
export function noRunFolders(deviceName: string): string {
	return `Update Night Shift on ${deviceName} to run projects without a folder.`;
}

/** A run id as a folder name: no separator, no `..`. */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Not listed and never served: a git folder a step made. */
const HIDDEN = ".git";

/** The entries of a folder by name, or none when it cannot be read. */
async function entriesOf(folder: string): Promise<Dirent[]> {
	try {
		const entries = await readdir(folder, { withFileTypes: true });
		return entries.sort((a, b) =>
			a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
		);
	} catch {
		return [];
	}
}

/**
 * The files and folders under `root`, folder by folder (the top first),
 * at most `limit` of them. A link is counted, never followed or listed.
 */
async function walk(
	root: string,
	limit: number,
): Promise<{ files: string[]; folders: string[]; more: boolean }> {
	const files: string[] = [];
	const folders: string[] = [];
	const queue = [""];
	let seen = 0;
	for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
		for (const entry of await entriesOf(join(root, next))) {
			if (entry.name === HIDDEN) continue;
			if (seen === limit) return { files, folders, more: true };
			seen++;
			const path = next === "" ? entry.name : `${next}/${entry.name}`;
			if (entry.isDirectory()) {
				folders.push(path);
				queue.push(path);
			} else if (entry.isFile()) {
				files.push(path);
			}
		}
	}
	return { files, folders, more: false };
}

export function createRunFolders(dataDir: string) {
	const root = join(dataDir, "run-folders");

	/** The run's folder on this computer, made or not. Refuses an id that is not one. */
	function path(runId: string): string {
		if (!RUN_ID.test(runId)) {
			throw new Refusal("invalid", "That is not the id of a run.");
		}
		return join(root, runId);
	}

	/** The run's folder when it is one on this computer: a folder, not a link. */
	async function folderOf(runId: string): Promise<string | null> {
		const folder = path(runId);
		const info = await lstat(folder).catch(() => null);
		return info?.isDirectory() ? folder : null;
	}

	return {
		path,
		/**
		 * Makes the run's folder, unless it is there. `made`: it was not
		 * there before, so a run that had one lost what was in it.
		 */
		async make(runId: string): Promise<{ path: string; made: boolean }> {
			const folder = path(runId);
			const before = await stat(folder).catch(() => null);
			if (before?.isDirectory()) return { path: folder, made: false };
			await mkdir(folder, { recursive: true });
			return { path: folder, made: true };
		},
		/** Removes the run's folder and its files. One that is gone already is fine. */
		async remove(runId: string): Promise<void> {
			await rm(path(runId), { recursive: true, force: true });
		},

		/** The ids of the runs with a folder on this computer. */
		async runIds(): Promise<string[]> {
			return (await entriesOf(root)).flatMap((entry) =>
				entry.isDirectory() && RUN_ID.test(entry.name) ? [entry.name] : [],
			);
		},

		/**
		 * The files of the run's folder on this computer, by path: at most
		 * `RUN_FILES_MAX` entries, without `.git` and links. Null when the
		 * folder is not here.
		 */
		async list(runId: string): Promise<RunFolderList | null> {
			const folder = await folderOf(runId);
			if (!folder) return null;
			const walked = await walk(folder, RUN_FILES_MAX);
			const files = await Promise.all(
				walked.files.map(async (file): Promise<RunFile | null> => {
					const info = await lstat(join(folder, file)).catch(() => null);
					return info?.isFile()
						? { path: file, size: info.size, modifiedAt: info.mtimeMs }
						: null;
				}),
			);
			return {
				files: files
					.filter((file): file is RunFile => file !== null)
					.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
				more: walked.more,
			};
		},

		/**
		 * One file of the run's folder (`relative`, with `/` between
		 * folders) and where it is on this computer. Null when there is no
		 * file at that path, or a link is on the way. Refuses a path that
		 * leaves the folder or goes into `.git`.
		 */
		async file(
			runId: string,
			relative: string,
		): Promise<{ file: RunFile; path: string } | null> {
			const parts = relative.split("/");
			if (
				parts.some(
					(part) =>
						part === "" ||
						part === "." ||
						part === ".." ||
						part === HIDDEN ||
						part.includes("\0"),
				)
			) {
				throw new Refusal("invalid", NOT_A_RUN_FILE);
			}
			const folder = await folderOf(runId);
			if (!folder) return null;
			try {
				const real = await realpath(join(folder, ...parts));
				// A link anywhere on the way makes the real path another one.
				if (real !== join(await realpath(folder), ...parts)) return null;
				const info = await lstat(real);
				if (!info.isFile()) return null;
				return {
					file: {
						path: parts.join("/"),
						size: info.size,
						modifiedAt: info.mtimeMs,
					},
					path: real,
				};
			} catch {
				return null;
			}
		},

		/**
		 * When something in the run's folder last changed: the newest change
		 * of the folder and the entries `list` walks. Null when it is not here.
		 */
		async lastChange(runId: string): Promise<number | null> {
			const folder = await folderOf(runId);
			if (!folder) return null;
			const walked = await walk(folder, RUN_FILES_MAX);
			const times = await Promise.all(
				["", ...walked.folders, ...walked.files].map(
					async (entry) =>
						(await lstat(join(folder, entry)).catch(() => null))?.mtimeMs ?? 0,
				),
			);
			return Math.max(...times);
		},
	};
}
