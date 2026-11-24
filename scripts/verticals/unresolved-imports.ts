/**
 * Rule (r) of `scripts/check-verticals.ts`: a relative or aliased import
 * that names no file.
 *
 * Bun finds such an import only when it runs the file, and it drops an
 * `import type` unread. So a moved folder can leave a test file that does
 * not load. This rule reads every import form that `parse` reads, in
 * source and tests of every workspace, the ones in NOT_CHECKED too.
 *
 * Biome's `correctness/noUnresolvedImports` is not enough: it does not read
 * a type written as `import("x").Name`, and it fails correct imports of
 * packages (`Fragment` of React), with no option for relative paths only.
 */

import { dirname, join, relative, resolve, sep } from "node:path";

import { aliases, resolveFile, resolverFor } from "./resolve";
import { parse, walk } from "./source-file";

/** React Native reads `x.ios.tsx` for an import of `x`. Types read `x.d.ts`. */
const SUFFIXES = ["ios", "android", "native", "web", "d"];

/**
 * The environment without the `GIT_*` names of a hook. With `GIT_DIR`, git
 * works on the repository of the hook, not on the folder it runs in.
 */
export const gitEnv = (): Record<string, string | undefined> =>
	Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
	);

/** Git ignores the file: a tool writes it (`env.ts`, `routeTree.gen.ts`). */
function generated(root: string, base: string): boolean {
	const file = relative(root, base);
	const files = [file, `${file}.ts`, `${file}.tsx`];
	const git = Bun.spawnSync(["git", "check-ignore", "--", ...files], {
		cwd: root,
		env: gitEnv(),
		stdout: "ignore",
		stderr: "ignore",
	});
	return git.exitCode === 0;
}

/** What breaks rule (r), as messages. `root` is the repository root. */
export function checkUnresolvedImports(
	root: string,
	workspaces: string[],
): string[] {
	const problems: string[] = [];
	for (const workspace of workspaces) {
		const wsDir = resolve(root, workspace);
		const resolveImport = resolverFor(wsDir);
		const pathAliases = aliases(wsDir);
		const paths: string[] = [];
		walk(wsDir, paths, true);
		for (const path of paths) {
			for (const { specifier: written } of parse(path).imports) {
				// `./index.css?url` is Vite's way to ask for the URL of a file.
				const specifier = written.replace(/\?.*$/, "");
				const alias = pathAliases.find((a) => specifier.startsWith(a.prefix));
				if (!specifier.startsWith(".") && !alias) continue;
				if (resolveImport(path, specifier)) continue;
				const base = alias
					? join(alias.target, specifier.slice(alias.prefix.length))
					: resolve(dirname(path), specifier);
				if (
					SUFFIXES.some((suffix) => resolveFile(`${base}.${suffix}`)) ||
					generated(root, base)
				)
					continue;
				problems.push(
					`${relative(root, path).split(sep).join("/")}: imports "${written}", which names no file. Fix the path.`,
				);
			}
		}
	}
	return problems;
}
