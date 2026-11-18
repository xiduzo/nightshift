/**
 * Rule (q) of `scripts/check-verticals.ts`: a source file of a vertical
 * that no production file of its workspace imports.
 *
 * The barrel rules (b) and (o) start at a barrel, and the entry rule (m)
 * starts at an entry. A file that nothing imports is on no barrel, so none
 * of them sees it. Its test keeps passing, and the code looks alive.
 *
 * What counts as an import:
 * - Any import of a production file of the workspace: a file of the
 *   vertical, of another vertical, an entry file, a route, a config file
 *   or a script. A type-only import counts.
 * - An import of a platform sibling. React Native reads `run-header.tsx`,
 *   `run-header.ios.tsx` or `run-header.android.tsx` for one import, so an
 *   import of one of them counts for all of them.
 * - A script of the workspace's `package.json` that names the file
 *   (`bun src/features/cli/data-migrate.ts`).
 * - An entry of the package (`exports`).
 *
 * A test does not count as an importer: a file that only its test imports
 * is not used. Tests and test code are not checked themselves, nor is a
 * file outside a vertical (an entry file, a route).
 *
 * The command runs this rule for each workspace (`checkWorkspaces`). It is
 * not a part of `checkWorkspace`, so a small tree in the test of another
 * rule may hold a file that nothing imports.
 */

import { join, relative, resolve, sep } from "node:path";

import { isTest } from "../check-layers";
import { entryFiles, packageJson, resolverFor } from "./resolve";
import { parse, walk } from "./source-file";
import { verticalsOf } from "./vertical";

/** `run-header.ios.tsx` and `run-header.android.tsx` are `run-header`. */
const PLATFORM = /\.(?:ios|android|native|web)(?=\.tsx?$)/;

/** One name for a file and its platform siblings. */
const siblingKey = (path: string): string =>
	path.replace(PLATFORM, "").replace(/\.tsx?$/, "");

/**
 * What breaks rule (q) in one workspace (`apps/web`, `packages/engine`),
 * as messages. `root` is the repository root.
 */
export function checkUnusedFiles(root: string, workspace: string): string[] {
	const wsDir = resolve(root, workspace);
	const app = workspace.replace(/\\/g, "/").startsWith("apps/");
	const verticals = verticalsOf(join(wsDir, "src"), app);
	const resolveImport = resolverFor(wsDir);
	const paths: string[] = [];
	walk(wsDir, paths, true);
	const test = (path: string) => isTest(relative(wsDir, path));

	const used = new Set<string>();
	const byTest = new Set<string>();
	for (const path of paths) {
		for (const { specifier } of parse(path).imports) {
			const target = resolveImport(path, specifier);
			if (!target || target === path) continue;
			(test(path) ? byTest : used).add(siblingKey(target));
		}
	}

	const entries = entryFiles(wsDir);
	const scripts = Object.values(packageJson(wsDir).scripts ?? {});
	const problems: string[] = [];
	for (const path of paths) {
		if (test(path) || entries.has(path)) continue;
		if (!verticals.some((v) => path.startsWith(`${v.dir}${sep}`))) continue;
		const key = siblingKey(path);
		if (used.has(key)) continue;
		const inWorkspace = relative(wsDir, path).split(sep).join("/");
		if (scripts.some((command) => command.includes(inWorkspace))) continue;
		const only = byTest.has(key);
		problems.push(
			`${relative(root, path).split(sep).join("/")}: no production file imports it${only ? ", only a test does" : ""}. Remove it${only ? " with its test" : ""}, or import it where it is used.`,
		);
	}
	return problems;
}
