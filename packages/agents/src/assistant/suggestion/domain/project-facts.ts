/**
 * What a command suggestion needs to know of the project before the agent
 * reads anything: its package manager and its scripts. Read from the
 * project's folder, so the agent starts from the real names, not guesses.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export type ProjectFacts = {
	/** From the lock file: `bun`, `pnpm`, `yarn` or `npm`. Null: no lock file. */
	packageManager: string | null;
	/** The scripts of `package.json`, by name. */
	scripts: Record<string, string>;
	/** Other files that name commands: `Makefile`, `justfile`, `Taskfile.yml`. */
	taskFiles: string[];
};

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

/** The project's package manager, scripts and task files. Never throws: what it cannot read stays empty. */
export async function readProjectFacts(cwd: string): Promise<ProjectFacts> {
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
}
