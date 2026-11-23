import { lstat, readdir, readFile, rmdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Git } from "../../../../git";
import type { CloneFolders } from "../../application/ports";
import {
	LEGACY_FOLDER,
	type LegacyFolder,
	type LegacySource,
	LITTER,
	parseJson,
	trackedStateOf,
} from "../../domain/legacy-folder";

/** The `.nightshift/` folder of each Clone on this computer's disk, and git for what it tracks. */
export function fsCloneFolders(deps: { git: Pick<Git, "run"> }): CloneFolders {
	return {
		read: readLegacyFolder,
		async tracked(repoPath, folder) {
			const result = await deps.git.run(repoPath, [
				"ls-files",
				"-z",
				"--",
				LEGACY_FOLDER,
			]);
			if (result.exitCode !== 0) {
				throw new Error(`git ls-files failed: ${result.stderr}`);
			}
			return trackedStateOf(result.stdout.split("\0"), folder);
		},
		remove: deleteLegacyFolder,
	};
}

/**
 * Reads the folder. Null when the Clone has none. A link or a file of
 * that name is not read: it is `unknown`, so it stays.
 */
async function readLegacyFolder(
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

/**
 * Deletes the files the import read, each only while it still holds what
 * was read, then the folders when they are empty. Never removes what it
 * did not read: a file that changed or came in since keeps its folder.
 * True when the folder is gone.
 */
async function deleteLegacyFolder(
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
