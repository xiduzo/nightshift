/**
 * Lists the workspaces whose tests CI runs: every `apps/*` and `packages/*`
 * workspace with at least one test file (`*.test.ts` or `*.test.tsx`), apart
 * from `*.live.test.ts`. Those need real services. CI makes one test job per
 * workspace from this list, so the tests of a new workspace run from its
 * first commit.
 *
 *   bun scripts/test-workspaces.ts
 *
 * Prints the list as one line of JSON, for example
 * `["apps/desktop","packages/engine"]`.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Folders that hold no tests of the workspace. CI's test step skips them too. */
const SKIP = new Set(["node_modules", "dist", ".hutch"]);

/** A test file that CI runs. */
export function runsInCi(name: string): boolean {
	return (
		(name.endsWith(".test.ts") || name.endsWith(".test.tsx")) &&
		!name.endsWith(".live.test.ts")
	);
}

function hasTest(dir: string): boolean {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) {
			if (!SKIP.has(entry.name) && hasTest(join(dir, entry.name))) return true;
		} else if (entry.isFile() && runsInCi(entry.name)) {
			return true;
		}
	}
	return false;
}

/** The workspaces under `root` with a test that CI runs, sorted. */
export function testWorkspaces(root: string): string[] {
	const found: string[] = [];
	for (const group of ["apps", "packages"]) {
		const dir = join(root, group);
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const workspace = join(dir, entry.name);
			if (!existsSync(join(workspace, "package.json"))) continue;
			if (hasTest(workspace)) found.push(`${group}/${entry.name}`);
		}
	}
	return found.sort();
}

if (import.meta.main) {
	console.log(JSON.stringify(testWorkspaces(join(import.meta.dir, ".."))));
}
