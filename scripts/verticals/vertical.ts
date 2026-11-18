/** The verticals of a workspace, found from the file system. */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { resolveFile } from "./resolve";
import { skipped } from "./source-file";

/**
 * A vertical by its path in `src/` (`features/runs`, `shared/api`,
 * `graph`), its folder, and its `index.ts` barrel when it has one.
 */
export type Vertical = { name: string; dir: string; barrel?: string };

/**
 * An app: every folder in `src/features/` and `src/shared/`. A package:
 * every folder directly in `src/`, except `testing/`.
 */
export function verticalsOf(src: string, app: boolean): Vertical[] {
	const roots = app
		? [
				{ dir: join(src, "features"), prefix: "features/" },
				{ dir: join(src, "shared"), prefix: "shared/" },
			]
		: [{ dir: src, prefix: "" }];
	const found: Vertical[] = [];
	for (const { dir, prefix } of roots) {
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory() || skipped(entry.name)) continue;
			if (!app && entry.name === "testing") continue;
			const path = join(dir, entry.name);
			found.push({
				name: `${prefix}${entry.name}`,
				dir: path,
				barrel: resolveFile(join(path, "index")),
			});
		}
	}
	return found;
}
