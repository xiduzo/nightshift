/**
 * What a command suggestion needs to know of the project before the agent
 * reads anything: its package manager and its scripts. Read from the
 * project's folder, so the agent starts from the real names, not guesses.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { ProjectFactsReader } from "../../application/ports";

const LOCK_FILES: [file: string, manager: string][] = [
	["bun.lock", "bun"],
	["bun.lockb", "bun"],
	["pnpm-lock.yaml", "pnpm"],
	["yarn.lock", "yarn"],
	["package-lock.json", "npm"],
];

const TASK_FILES = ["Makefile", "justfile", "Taskfile.yml", "Cargo.toml"];

async function exists(path: string): Promise<boolean> {
	return stat(path).then(
		() => true,
		() => false,
	);
}

/** `ProjectFactsReader` over the folder of the project. */
export const folderProjectFactsReader: ProjectFactsReader = async (cwd) => {
	let packageManager: string | null = null;
	for (const [file, manager] of LOCK_FILES) {
		if (await exists(join(cwd, file))) {
			packageManager = manager;
			break;
		}
	}
	let scripts: Record<string, string> = {};
	try {
		const manifest = JSON.parse(
			await readFile(join(cwd, "package.json"), "utf8"),
		) as { scripts?: unknown };
		if (manifest.scripts && typeof manifest.scripts === "object") {
			scripts = Object.fromEntries(
				Object.entries(manifest.scripts).filter(
					(entry): entry is [string, string] => typeof entry[1] === "string",
				),
			);
		}
	} catch {
		// No package.json, or one that is not valid: no scripts.
	}
	const taskFiles: string[] = [];
	for (const file of TASK_FILES) {
		if (await exists(join(cwd, file))) taskFiles.push(file);
	}
	return { packageManager, scripts, taskFiles };
};
