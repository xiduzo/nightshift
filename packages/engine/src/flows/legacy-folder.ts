import { lstat, readdir, readFile, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Git } from "../projects";

/**
 * The `.nightshift/` folder of a Clone from before ADR 2: the flows in
 * `flows/<name>.json`, `schedules.json` and `profiles.json`. Only the
 * import on upgrade (`import.ts`) reads it, once per Clone. It reads the
 * files itself, so it keeps working when the flow file readers go.
 */

/** The folder's name in a Clone. The one path a notice may name. */
export const LEGACY_FOLDER = ".nightshift";

/** One file of the folder as it was read: its text, to check before it is deleted. */
export type LegacyFile = {
	/** Relative to the folder, for example `flows/build.json`. */
	path: string;
	text: string;
};

/** A JSON file of the folder: its parsed JSON, or why it is not JSON. */
export type LegacySource = { json: unknown } | { jsonError: string };

/** What the folder holds, as read. */
export type LegacyFolder = {
	/** Each flow file by its name (`build` for `flows/build.json`). */
	flows: Map<string, LegacySource>;
	schedules: LegacySource | null;
	profiles: LegacySource | null;
	/** Every file it read: the files a delete may remove. */
	files: LegacyFile[];
	/**
	 * What the import does not know, relative to the folder: another
	 * file, a folder, a link. Their presence keeps the folder.
	 */
	unknown: string[];
};

/** Files a computer leaves in a folder: they go with it. */
const LITTER = new Set([".DS_Store"]);

/**
 * Reads the folder. Null when the Clone has none. A link or a file of
 * that name is not read: it is `unknown`, so it stays.
 */
export async function readLegacyFolder(
	repoPath: string,
): Promise<LegacyFolder | null> {
	const root = join(repoPath, LEGACY_FOLDER);
	const stat = await lstatOrNull(root);
	if (stat === null) return null;
	const folder: LegacyFolder = {
		flows: new Map(),
		schedules: null,
		profiles: null,
		files: [],
		unknown: [],
	};
	if (!stat.isDirectory()) {
		folder.unknown.push("");
		return folder;
	}
	const read = async (path: string): Promise<LegacySource> => {
		const text = await readFile(join(root, path), "utf8");
		folder.files.push({ path, text });
		return parseJson(text);
	};
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const name = entry.name;
		if (entry.isFile() && name === "schedules.json") {
			folder.schedules = await read(name);
		} else if (entry.isFile() && name === "profiles.json") {
			folder.profiles = await read(name);
		} else if (entry.isFile() && LITTER.has(name)) {
			await read(name);
		} else if (entry.isDirectory() && name === "flows") {
			for (const file of await readdir(join(root, name), {
				withFileTypes: true,
			})) {
				const path = `flows/${file.name}`;
				if (file.isFile() && file.name.endsWith(".json")) {
					folder.flows.set(
						file.name.slice(0, -".json".length),
						await read(path),
					);
				} else if (file.isFile() && LITTER.has(file.name)) {
					await read(path);
				} else {
					folder.unknown.push(path);
				}
			}
		} else {
			folder.unknown.push(name);
		}
	}
	return folder;
}

function parseJson(text: string): LegacySource {
	try {
		return { json: JSON.parse(text) };
	} catch (error) {
		return {
			jsonError: error instanceof Error ? error.message : String(error),
		};
	}
}

/** How much of the folder git tracks. */
export type TrackedState = "untracked" | "tracked" | "partial";

/**
 * How much of a Clone's folder git tracks: none of its files, all of
 * them, or some. Throws when git cannot tell (no repository, no git): the
 * folder then stays.
 */
export async function trackedState(
	git: Pick<Git, "run">,
	repoPath: string,
	folder: Pick<LegacyFolder, "files">,
): Promise<TrackedState> {
	const result = await git.run(repoPath, [
		"ls-files",
		"-z",
		"--",
		LEGACY_FOLDER,
	]);
	if (result.exitCode !== 0) {
		throw new Error(`git ls-files failed: ${result.stderr}`);
	}
	const tracked = new Set(
		result.stdout
			.split("\0")
			.filter((path) => path.length > 0)
			.map((path) => path.slice(LEGACY_FOLDER.length + 1)),
	);
	if (tracked.size === 0) return "untracked";
	return folder.files
		.filter((file) => !LITTER.has(file.path.split("/").at(-1) ?? ""))
		.every((file) => tracked.has(file.path))
		? "tracked"
		: "partial";
}

/**
 * Deletes the files the import read, each only while it still holds what
 * was read, then the folders when they are empty. Never removes what it
 * did not read: a file that changed or came in since keeps its folder.
 * True when the folder is gone.
 */
export async function deleteLegacyFolder(
	repoPath: string,
	folder: Pick<LegacyFolder, "files">,
): Promise<boolean> {
	const root = join(repoPath, LEGACY_FOLDER);
	let changed = false;
	for (const file of folder.files) {
		const path = join(root, file.path);
		const now = await readFile(path, "utf8").catch(() => null);
		if (now !== file.text) {
			changed = true;
			continue;
		}
		await unlink(path);
	}
	if (changed) return false;
	for (const path of [join(root, "flows"), root]) {
		try {
			await rmdir(path);
		} catch (error) {
			if (codeOf(error) !== "ENOENT") return false;
		}
	}
	return (await lstatOrNull(root)) === null;
}

async function lstatOrNull(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if (codeOf(error) === "ENOENT") return null;
		throw error;
	}
}

function codeOf(error: unknown): unknown {
	return typeof error === "object" && error !== null && "code" in error
		? error.code
		: undefined;
}
