/**
 * A path that a living doc names exists. This fails a doc that names a
 * file or a folder the repository does not have.
 *
 * The living docs are the README, CONTRIBUTING, AGENTS and SECURITY files,
 * the Markdown files directly in `docs/` and in `docs/steering/`, every
 * file in `.github/`, and `lefthook.yml`. The check does not read the
 * records (`docs/adr/`, `docs/research/`): they stay as written. It does
 * not read the user guide (`docs/wiki/`): it names no path.
 *
 * Two kinds of mention are paths:
 * (a) A path from the root. Its first part is a folder at the top of the
 *     repository: `apps/web/src/router.tsx`, `packages/flows/src/kits/**`.
 *     It names a file or a folder of the repository. A link from the
 *     doc's own folder passes too (`deploy/monitoring.md` in a file of
 *     `docs/`).
 * (b) A TypeScript file below a folder: `graph/step/sleep.ts`,
 *     `features/runs/list/run-list.tsx`. A file of the repository ends
 *     with it.
 *
 * A file of the repository is a file that git tracks, or a new file that
 * git does not ignore.
 *
 * `*`, `**`, `{a,b}` and `<name>` in a path match as in a glob. So a glob
 * of the pre-commit hook or of a workflow that matches nothing fails.
 *
 * A path that git ignores passes: an `.env` file and build output are not
 * in the repository on purpose. Other mentions are not paths for this
 * check: a file name alone (`context.ts`), a folder below another
 * (`adapters/out/`), a package entry (`@nightshift/engine/run-status`), a
 * URL.
 *
 * EXAMPLES lists the paths a doc names on purpose though the repository
 * does not have them, each with its reason. An entry that no doc needs
 * any more fails: its path exists now, or no doc names it.
 *
 *   bun scripts/check-doc-paths.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Paths a doc names on purpose, with the reason. A key covers the path and
 * everything below it.
 */
export const EXAMPLES: Record<string, string> = {
	// The desktop build writes them. Git does not ignore them by name.
	"apps/desktop/artifacts": "build output of the desktop app",
	"apps/desktop/.hutch": "the build cache of the desktop app",
	// docs/shadcn.md: where the shadcn CLI puts a file, which then moves.
	"apps/web/src/hooks": "a folder that must not exist",
	"apps/web/src/components": "a folder that must not exist",
	// docs/knowledge.md: the folders of a person's own project.
	"docs/private": "a folder of an example project",
	"docs/standaard": "a folder of an example project",
	// docs/PLAN.md: the name the starters had before.
	"examples/starters": "an old name, named as history",
	// AGENTS.md: the block that turbo writes names a file of its package.
	"docs/README.md": "a file of the turbo package",
	// The same block: `require.resolve('turbo/package.json')`. The folder
	// `turbo/` of the repository holds the generators, so the check reads it.
	"turbo/package.json": "a file of the turbo package",
};

const ROOT_DOCS = ["README.md", "CONTRIBUTING.md", "AGENTS.md", "SECURITY.md"];

/** The living docs among the `files` of the repository. */
export function livingDocs(files: string[]): string[] {
	return files.filter(
		(file) =>
			ROOT_DOCS.includes(file) ||
			file === "lefthook.yml" ||
			file.startsWith(".github/") ||
			/^docs\/(?:steering\/)?[^/]+\.md$/.test(file),
	);
}

export type Mention = { line: number; path: string };

const URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/g;
const PART = String.raw`(?:[\w.@+$*-]|<[\w -]+>|\[[\w.-]+\]|\{[\w,.* -]+\})+`;
const MENTION = new RegExp(
	String.raw`(?<![\w@./:<{[$*-])((?:\.github|[A-Za-z][\w.-]*)(?:/${PART})+)`,
	"g",
);

/** Every mention in `text` that has the form of a path: `a/b`, `a/b/c.ts`. */
export function pathMentions(text: string): Mention[] {
	const found: Mention[] = [];
	text.split("\n").forEach((raw, index) => {
		const line = raw.replace(URL, " ");
		for (const match of line.matchAll(MENTION)) {
			const path = (match[1] as string)
				.replace(/[.,:;]+$/, "")
				.replace(/:\d+(?:-\d+)?$/, "")
				.replace(/\/+$/, "");
			if (path.includes("/")) found.push({ line: index + 1, path });
		}
	});
	return found;
}

const isPattern = (path: string) => /[*<{]/.test(path);

/** The glob `path` as the source of a regular expression. */
function patternOf(path: string): string {
	const within = (text: string) =>
		text
			.replace(/[.+^$()|[\]\\]/g, "\\$&")
			.replace(
				/\{([^}]+)\}/g,
				(_, list: string) => `(?:${list.split(",").join("|")})`,
			)
			.replace(/\*/g, "[^/]*")
			.replace(/<[^>]+>/g, "[^/]+");
	// `**` crosses folders. The other wildcards stay in one.
	return path
		.split(/\*\*\/?/)
		.map(within)
		.join(".*");
}

/** The part of a glob before its first wildcard, as a folder. */
function fixedPart(path: string): string {
	const at = path.search(/[*<{]/);
	if (at < 0) return path;
	return path.slice(0, at).replace(/\/[^/]*$/, "");
}

export type DocPathInput = {
	/** The text of each living doc, by its path from the root. */
	docs: Record<string, string>;
	/** Every file of the repository, by its path from the root. */
	files: string[];
	/** Whether git ignores a path. */
	ignored?: (path: string) => boolean;
	examples?: Record<string, string>;
};

/** The paths the `docs` name that the repository does not have. */
export function docPathProblems(input: DocPathInput): string[] {
	const { docs, files } = input;
	const examples = input.examples ?? EXAMPLES;
	const ignored = input.ignored ?? (() => false);

	const entries = new Set<string>();
	for (const file of files) {
		const parts = file.split("/");
		for (let i = 1; i <= parts.length; i++) {
			entries.add(parts.slice(0, i).join("/"));
		}
	}
	const all = [...entries];
	const top = new Set(all.filter((entry) => !entry.includes("/")));

	const fromRoot = (path: string): boolean => {
		if (!isPattern(path)) return entries.has(path);
		const shape = new RegExp(`^${patternOf(path)}(?:/|$)`);
		return all.some((entry) => shape.test(entry));
	};
	const atTheEnd = (path: string): boolean => {
		if (!isPattern(path)) {
			return files.some((file) => file === path || file.endsWith(`/${path}`));
		}
		const shape = new RegExp(`(?:^|/)${patternOf(path)}$`);
		return files.some((file) => shape.test(file));
	};

	const used = new Set<string>();
	const exampleOf = (path: string): boolean => {
		for (const key of Object.keys(examples)) {
			if (path === key || path.startsWith(`${key}/`)) {
				used.add(key);
				return true;
			}
		}
		return false;
	};

	const problems: string[] = [];
	for (const doc of Object.keys(docs).sort()) {
		const folder = dirname(doc);
		for (const { line, path } of pathMentions(docs[doc] as string)) {
			const first = path.split("/")[0] as string;
			if (top.has(first)) {
				if (fromRoot(path)) continue;
				if (folder !== "." && fromRoot(`${folder}/${path}`)) continue;
				if (exampleOf(path) || ignored(fixedPart(path))) continue;
				problems.push(
					`${doc}:${line} names \`${path}\`. The repository has no such file or folder.`,
				);
			} else if (/\.tsx?$/.test(path)) {
				if (atTheEnd(path) || exampleOf(path)) continue;
				problems.push(
					`${doc}:${line} names \`${path}\`. No file of the repository ends with that path.`,
				);
			}
		}
	}
	for (const key of Object.keys(examples)) {
		if (!used.has(key)) {
			problems.push(
				`scripts/check-doc-paths.ts: no doc needs the example \`${key}\` any more. Remove it from EXAMPLES.`,
			);
		}
	}
	return problems;
}

/** The output lines of a git command in `root`. */
function git(root: string, args: string[]): { ok: boolean; lines: string[] } {
	const result = Bun.spawnSync(["git", ...args], { cwd: root });
	const lines = result.stdout.toString().split("\n").filter(Boolean);
	return { ok: result.exitCode === 0, lines };
}

/** Problems in the repository at `root`. Git says which files it has. */
export function checkDocPaths(root: string): string[] {
	// The files git tracks, and the new ones it does not ignore.
	const files = git(root, [
		"ls-files",
		"--cached",
		"--others",
		"--exclude-standard",
	]).lines;
	const docs: Record<string, string> = {};
	for (const doc of livingDocs(files)) {
		docs[doc] = readFileSync(join(root, doc), "utf8");
	}
	const ignored = (path: string) =>
		git(root, ["check-ignore", "-q", "--", path]).ok;
	return docPathProblems({ docs, files, ignored });
}

if (import.meta.main) {
	const problems = checkDocPaths(join(import.meta.dir, ".."));
	if (problems.length > 0) {
		console.error(
			"Doc path check failed (docs/steering/STRUCTURE.md, section 7):\n",
		);
		for (const problem of problems) console.error(`  ${problem}`);
		console.error(
			"\nWrite the path the file has now. A path that a doc names as an example goes in EXAMPLES of scripts/check-doc-paths.ts, with the reason.",
		);
		process.exit(1);
	}
	console.log("Doc paths OK.");
}
