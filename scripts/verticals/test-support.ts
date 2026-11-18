/**
 * Small trees in a temporary folder, for the tests of the vertical rules.
 * A test file calls `afterAll(removeTrees)`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const roots: string[] = [];

/** Writes `files` (path from the root → text) to a new root. */
export function writeTree(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "check-verticals-"));
	roots.push(root);
	for (const [path, text] of Object.entries(files)) {
		const full = join(root, path);
		mkdirSync(dirname(full), { recursive: true });
		writeFileSync(full, text);
	}
	return root;
}

/** Removes every tree that `writeTree` wrote. */
export function removeTrees(): void {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
}

/** The same files, each path under `workspace`. */
export const inWorkspace = (
	workspace: string,
	files: Record<string, string>,
): Record<string, string> =>
	Object.fromEntries(
		Object.entries(files).map(([path, text]) => [`${workspace}/${path}`, text]),
	);

/** `count` source files in `dir`, one line each: `part-0.ts`, `part-1.ts`. */
export const sourceFiles = (
	dir: string,
	count: number,
	extension = ".ts",
): Record<string, string> =>
	Object.fromEntries(
		Array.from({ length: count }, (_, i) => [
			`${dir}/part-${i}${extension}`,
			`export const part${i} = ${i};\n`,
		]),
	);

/** A source file of `lines` lines that exports `name`. */
export const longFile = (name: string, lines: number): string =>
	`${"// One more line.\n".repeat(lines - 1)}export const ${name} = 1;\n`;
