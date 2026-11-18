/**
 * The names a folder or a file may not take, and rule (n) of
 * `scripts/check-verticals.ts`: no kind folder inside a vertical.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

import type { Finding } from "./debt";
import { skipped } from "./source-file";
import type { Vertical } from "./vertical";

/** Kind buckets: never a folder at the top of `src/` (c). */
export const KIND_BUCKETS = new Set([
	"lib",
	"utils",
	"helpers",
	"hooks",
	"components",
	"types",
	"common",
	"misc",
]);

/**
 * Kind folders: a folder named for the kind of code it holds, not for a
 * sub-domain. Never a folder inside a vertical, at any depth (n). These are
 * the kind buckets, and the two kind names that only show inside a
 * vertical.
 */
export const KIND_FOLDERS = new Set([...KIND_BUCKETS, "queries", "mutations"]);

/**
 * Catch-all names: they say nothing of what a file holds, so anything ends
 * up in them. Never a file name or a folder name, at any depth. `shared` is
 * an app's folder of named shared pieces, so only a file may not take it.
 */
export const CATCH_ALL_FOLDERS = new Set([
	"utils",
	"util",
	"helpers",
	"helper",
	"common",
	"misc",
]);
export const CATCH_ALL_FILES = new Set([...CATCH_ALL_FOLDERS, "shared"]);

/**
 * (n) Each kind folder inside a vertical, at any depth, in path order. It
 * reads the folders, so a kind folder that holds no source file counts
 * too. A catch-all folder is not listed here: rule (k) fails it, and that
 * rule has no debt list.
 */
export function kindFolderFindings(
	verticals: Vertical[],
	rel: (path: string) => string,
): Finding[] {
	const found: Finding[] = [];
	const visit = (dir: string, vertical: Vertical): void => {
		const folders = readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && !skipped(entry.name))
			.map((entry) => entry.name)
			.sort();
		for (const name of folders) {
			const path = join(dir, name);
			if (KIND_FOLDERS.has(name) && !CATCH_ALL_FOLDERS.has(name)) {
				found.push({
					line: rel(path),
					message: `${rel(path)}/: "${name}" is a kind folder inside the vertical ${vertical.name}. Name a folder for its sub-domain, and move each file into the sub-domain that uses it.`,
				});
			}
			visit(path, vertical);
		}
	};
	for (const vertical of [...verticals].sort((a, b) =>
		a.dir < b.dir ? -1 : 1,
	))
		visit(vertical.dir, vertical);
	return found;
}
