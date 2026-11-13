import { mkdtempSync, rmSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import type { ArtifactStore } from "../artifacts";

/** The environment variable that names a Command step's folder of files to keep. */
export const ARTIFACTS_ENV = "NS_ARTIFACTS";

/**
 * A Command step's folder of files to keep, named in `NS_ARTIFACTS`: what
 * a command puts there becomes an artifact of the run when it exits, as
 * `save_artifact` does for an agent. The folder is new and empty, in a
 * folder of its own under the system's temp folder, and goes afterwards.
 */
export type KeptFiles = {
	path: string;
	/**
	 * Keeps every file in the folder, sub-folders too, in name order. Each
	 * file is titled with its path in the folder. Returns one line for each
	 * file it could not keep, for the command's log.
	 */
	keep: () => Promise<string[]>;
	/** Removes the folder. Safe to call twice. */
	remove: () => void;
};

/** A new, empty folder. Throws when it cannot make one. */
export function openKeptFiles(
	store: Pick<ArtifactStore, "save">,
	step: { runId: string; stepId: string },
): KeptFiles {
	const path = mkdtempSync(join(tmpdir(), "nightshift-artifacts-"));
	return {
		path,
		async keep() {
			const entries = await readdir(path, {
				recursive: true,
				withFileTypes: true,
			}).catch(() => []);
			const files = entries
				.filter((entry) => entry.isFile())
				.map((entry) => relative(path, join(entry.parentPath, entry.name)))
				.sort();
			const problems: string[] = [];
			for (const file of files) {
				try {
					await store.save({ ...step, cwd: path, path: file, title: file });
				} catch (error) {
					problems.push(
						`Night Shift could not keep ${file}: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
			return problems;
		},
		remove() {
			rmSync(path, { recursive: true, force: true });
		},
	};
}
