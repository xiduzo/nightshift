import { copyFile, lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import type { WorktreeChanges, WorktreeFileChange } from "../log";
import { type Git, GitError, type GitRunOptions, gitOrThrow } from "./git";

/**
 * What a step changed in a worktree, over the git port: a snapshot of every
 * file before and after (`snapshotTree`), and the files that differ between
 * two snapshots with their diffs (`treeChanges`). Shell commands, formatters,
 * codegen and lockfiles show up as well as an agent's own edits.
 *
 * A snapshot is a git tree: the worktree's index copied to a file of its
 * own, every change added to that copy (`git add -A`: staged, unstaged and
 * untracked files, the ignored ones left out), and the tree written. The
 * worktree, its index and its branch do not change. The tree is an object
 * nothing refers to: git keeps it for weeks before a `gc` may prune it.
 *
 * The limits keep the cost small: a worktree with too many new files (a
 * folder git does not ignore) has no snapshot, and the diffs of one step
 * stop at a size.
 */

/** The limits of what a snapshot and a step's changes hold. */
export type ChangeLimits = {
	/** New files git does not ignore: more than this, and there is no snapshot. */
	untrackedFiles: number;
	/** Their size in bytes: more than this, and there is no snapshot. */
	untrackedBytes: number;
	/** Files listed per step; the rest are counted (`omitted`). */
	files: number;
	/** Bytes of one file's diff; a longer one is cut short. */
	filePatchBytes: number;
	/** Bytes of all diffs of one step; past them, files keep their counts only. */
	stepPatchBytes: number;
	/** Lines added and removed of one file past which it keeps its counts only. */
	patchLines: number;
	/** How long one git command may take. */
	timeoutMs: number;
};

export const CHANGE_LIMITS: ChangeLimits = {
	untrackedFiles: 10_000,
	untrackedBytes: 100 * 1024 * 1024,
	files: 1_000,
	filePatchBytes: 64 * 1024,
	stepPatchBytes: 512 * 1024,
	patchLines: 2_000,
	timeoutMs: 60_000,
};

/**
 * Files whose diff nobody reads: lockfiles and the like keep their counts
 * only. By file name, in any folder.
 */
const COUNTS_ONLY = new Set([
	"bun.lock",
	"bun.lockb",
	"package-lock.json",
	"npm-shrinkwrap.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"deno.lock",
	"Cargo.lock",
	"Gemfile.lock",
	"composer.lock",
	"poetry.lock",
	"Pipfile.lock",
	"uv.lock",
	"pdm.lock",
	"go.sum",
	"Podfile.lock",
	"Package.resolved",
	"mix.lock",
	"pubspec.lock",
	"flake.lock",
	"packages.lock.json",
	"gradle.lockfile",
]);

/** A worktree with more new files than a snapshot takes (`ChangeLimits`). */
export class WorktreeTooLargeError extends Error {
	constructor(cwd: string, what: string) {
		super(`${cwd} has ${what}: no snapshot of its files.`);
		this.name = "WorktreeTooLargeError";
	}
}

/** The snapshots and changes of worktrees, over the git port. */
export function createWorktreeSnapshots(
	git: Git,
	limits: ChangeLimits = CHANGE_LIMITS,
) {
	const run = (cwd: string, args: string[], options: GitRunOptions = {}) =>
		git.run(cwd, args, { timeoutMs: limits.timeoutMs, ...options });
	const must = async (
		cwd: string,
		args: string[],
		options: GitRunOptions = {},
	) => {
		const result = await run(cwd, args, options);
		if (result.exitCode !== 0 && !result.cut) {
			throw new GitError(args, result.exitCode, result.stderr);
		}
		return result;
	};

	/** Throws when the new files git does not ignore pass the limits. */
	async function checkUntracked(cwd: string): Promise<void> {
		const listed = await must(
			cwd,
			["ls-files", "-z", "--others", "--exclude-standard"],
			// A path is rarely longer: past this, there are too many anyway.
			{ maxOutputBytes: limits.untrackedFiles * 512 },
		);
		const paths = listed.stdout.split("\0").filter(Boolean);
		if (listed.cut || paths.length > limits.untrackedFiles) {
			throw new WorktreeTooLargeError(cwd, "too many new files");
		}
		let bytes = 0;
		for (let at = 0; at < paths.length; at += 256) {
			const sizes = await Promise.all(
				paths.slice(at, at + 256).map((path) =>
					lstat(join(cwd, path)).then(
						(found) => found.size,
						// Gone since git listed it.
						() => 0,
					),
				),
			);
			for (const size of sizes) bytes += size;
			if (bytes > limits.untrackedBytes) {
				throw new WorktreeTooLargeError(cwd, "too many bytes of new files");
			}
		}
	}

	/**
	 * A snapshot of every file in the worktree at `cwd` (its top folder):
	 * the id of a git tree with what is staged, what is not, and the new
	 * files git does not ignore. Nothing in the worktree changes.
	 */
	async function snapshotTree(cwd: string): Promise<string> {
		await checkUntracked(cwd);
		const index = resolve(
			cwd,
			(await gitOrThrow(git, cwd, ["rev-parse", "--git-path", "index"])) ||
				".git/index",
		);
		const folder = await mkdtemp(join(tmpdir(), "nightshift-snapshot-"));
		const copy = join(folder, "index");
		try {
			await copyFile(index, copy).catch((error: NodeJS.ErrnoException) => {
				// A repository with no index yet: `add` makes one.
				if (error.code !== "ENOENT") throw error;
			});
			const env = { GIT_INDEX_FILE: copy };
			await must(cwd, ["add", "-A"], { env });
			return (await must(cwd, ["write-tree"], { env })).stdout;
		} finally {
			await rm(folder, { recursive: true, force: true });
		}
	}

	/**
	 * The files that differ between the snapshots `from` and `to` of the
	 * worktree at `cwd`, by path, with renames found, and the diff of each
	 * up to the limits.
	 */
	async function treeChanges(
		cwd: string,
		from: string,
		to: string,
	): Promise<WorktreeChanges> {
		if (from === to) return { tree: to, files: [] };
		const tree = ["diff-tree", "-r", "-z", "-M", "--no-commit-id"];
		const [statuses, counts] = await Promise.all([
			must(cwd, [...tree, "--name-status", from, to]),
			must(cwd, [...tree, "--numstat", from, to]),
		]);
		const all = joinCounts(
			parseNameStatus(statuses.stdout),
			parseNumstat(counts.stdout),
		).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
		const files = all.slice(0, limits.files);
		await addPatches(cwd, from, to, files);
		return {
			tree: to,
			files,
			...(all.length > files.length
				? { omitted: all.length - files.length }
				: {}),
		};
	}

	/** Each file's diff, as far as the limits allow. Changes `files` in place. */
	async function addPatches(
		cwd: string,
		from: string,
		to: string,
		files: WorktreeFileChange[],
	): Promise<void> {
		const wanted: WorktreeFileChange[] = [];
		for (const file of files) {
			if (file.binary) continue;
			if (
				COUNTS_ONLY.has(basename(file.path)) ||
				file.added + file.removed > limits.patchLines
			) {
				file.truncated = true;
				continue;
			}
			wanted.push(file);
		}
		if (wanted.length === 0) return;
		const paths = wanted.flatMap((file) =>
			file.oldPath ? [file.oldPath, file.path] : [file.path],
		);
		// Each file's lines before its hunks name its paths about four times.
		const headers = paths.reduce(
			(sum, path) => sum + 4 * byteLength(path) + 160,
			0,
		);
		const out = await must(
			cwd,
			[
				"-c",
				"core.quotePath=false",
				"diff-tree",
				"-r",
				"-p",
				"-M",
				"--no-commit-id",
				"--no-color",
				"--no-ext-diff",
				"--no-textconv",
				"--src-prefix=a/",
				"--dst-prefix=b/",
				from,
				to,
				"--",
				...paths,
			],
			{
				// A path in a pathspec is the path, not a pattern.
				env: { GIT_LITERAL_PATHSPECS: "1" },
				// Twice the step's limit, for the hunks a file cuts short, and the headers.
				maxOutputBytes: limits.stepPatchBytes * 2 + headers,
			},
		);
		const blocks = splitPatch(out.stdout);
		const byPath = new Map(blocks.map((block) => [block.path, block.hunks]));
		// The output stops inside its last file's diff.
		const cutPath = out.cut ? blocks.at(-1)?.path : undefined;
		let budget = limits.stepPatchBytes;
		for (const file of wanted) {
			const found = byPath.get(file.path);
			if (found === undefined) {
				// Past the end of a cut output: the diff is not known.
				if (out.cut) file.truncated = true;
				continue;
			}
			// A rename alone, or a mode change, has no hunks.
			if (found === null) continue;
			let patch = file.path === cutPath ? withoutLastLine(found) : found;
			let cut = file.path === cutPath;
			if (byteLength(patch) > limits.filePatchBytes) {
				patch = withoutLastLine(cutToBytes(patch, limits.filePatchBytes));
				cut = true;
			}
			const size = byteLength(patch);
			if (patch === "" || size > budget) {
				file.truncated = true;
				continue;
			}
			budget -= size;
			file.patch = patch;
			if (cut) file.truncated = true;
		}
	}

	return { snapshotTree, treeChanges };
}

/** The operations on snapshots of worktrees (`createWorktreeSnapshots`). */
export type WorktreeSnapshots = ReturnType<typeof createWorktreeSnapshots>;

const STATUS: Record<string, WorktreeFileChange["status"]> = {
	A: "added",
	C: "added",
	D: "deleted",
	M: "modified",
	R: "renamed",
	T: "modified",
	U: "modified",
	X: "modified",
};

/** `git diff-tree -z --name-status`: a status, then one path, or two for a rename or a copy. */
function parseNameStatus(
	text: string,
): Pick<WorktreeFileChange, "path" | "oldPath" | "status">[] {
	const tokens = text.split("\0");
	const files: Pick<WorktreeFileChange, "path" | "oldPath" | "status">[] = [];
	for (let at = 0; at < tokens.length; ) {
		const code = tokens[at++]?.trim();
		if (!code) continue;
		const letter = code[0] ?? "M";
		if (letter === "R" || letter === "C") {
			const oldPath = tokens[at++] ?? "";
			const path = tokens[at++] ?? "";
			files.push(
				letter === "R"
					? { path, oldPath, status: "renamed" }
					: { path, status: "added" },
			);
		} else {
			files.push({
				path: tokens[at++] ?? "",
				status: STATUS[letter] ?? "modified",
			});
		}
	}
	return files.filter((file) => file.path !== "");
}

type Counts = { added: number; removed: number; binary: boolean };

/**
 * `git diff-tree -z --numstat`: `added<TAB>removed<TAB>path`, or with an
 * empty path for a rename, then its two paths. `-` counts a binary file.
 */
function parseNumstat(text: string): Map<string, Counts> {
	const tokens = text.split("\0");
	const counts = new Map<string, Counts>();
	for (let at = 0; at < tokens.length; ) {
		const line = tokens[at++] ?? "";
		const match = /^\s*(-|\d+)\t(-|\d+)\t(.*)$/s.exec(line);
		if (!match) continue;
		let path = match[3] ?? "";
		if (path === "") {
			at++;
			path = tokens[at++] ?? "";
		}
		const binary = match[1] === "-" || match[2] === "-";
		counts.set(path, {
			added: binary ? 0 : Number(match[1]),
			removed: binary ? 0 : Number(match[2]),
			binary,
		});
	}
	return counts;
}

function joinCounts(
	files: Pick<WorktreeFileChange, "path" | "oldPath" | "status">[],
	counts: Map<string, Counts>,
): WorktreeFileChange[] {
	return files.map((file) => {
		const found = counts.get(file.path);
		return {
			path: file.path,
			...(file.oldPath ? { oldPath: file.oldPath } : {}),
			status: file.status,
			added: found?.added ?? 0,
			removed: found?.removed ?? 0,
			...(found?.binary ? { binary: true as const } : {}),
		};
	});
}

/**
 * A patch of many files as the diff of each, in order, by its new path. A
 * file's hunks start at its first `@@` line: null for a file without one
 * (a rename alone, a mode change).
 */
export function splitPatch(
	text: string,
): { path: string; hunks: string | null }[] {
	const files: { path: string; hunks: string | null }[] = [];
	for (const block of text.split(/^(?=diff --git )/m)) {
		if (!block.startsWith("diff --git ")) continue;
		const lines = block.replace(/\n$/, "").split("\n");
		const header = lines[0] ?? "";
		const start = lines.findIndex((line) => line.startsWith("@@"));
		const head = start < 0 ? lines : lines.slice(0, start);
		const renamed = head.find((line) => line.startsWith("rename to "));
		const path = renamed
			? unquote(renamed.slice("rename to ".length))
			: headerPath(header.slice("diff --git ".length));
		if (path === null) continue;
		files.push({
			path,
			hunks: start < 0 ? null : lines.slice(start).join("\n"),
		});
	}
	return files;
}

/** The new path of a `diff --git a/<old> b/<new>` header, when its two paths are the same. */
function headerPath(rest: string): string | null {
	if (rest.startsWith('"')) {
		const [, second] = quotedPair(rest);
		return second?.startsWith("b/") ? second.slice(2) : null;
	}
	if (!rest.startsWith("a/")) return null;
	// "a/" + P + " b/" + P
	const size = (rest.length - 5) / 2;
	if (!Number.isInteger(size) || size < 1) return null;
	const path = rest.slice(2, 2 + size);
	return rest.slice(2 + size) === ` b/${path}` ? path : null;
}

/** The two paths of a header whose first one is quoted. */
function quotedPair(rest: string): [string, string | undefined] {
	const end = closingQuote(rest);
	const first = unquote(rest.slice(0, end + 1));
	const tail = rest.slice(end + 2);
	return [first, unquote(tail)];
}

function closingQuote(text: string): number {
	for (let at = 1; at < text.length; at++) {
		if (text[at] === "\\") at++;
		else if (text[at] === '"') return at;
	}
	return text.length - 1;
}

const ESCAPES: Record<string, string> = {
	a: "\x07",
	b: "\b",
	t: "\t",
	n: "\n",
	v: "\v",
	f: "\f",
	r: "\r",
	'"': '"',
	"\\": "\\",
};

/** A path as git quotes one with odd characters (C style, octal bytes), else as it is. */
function unquote(text: string): string {
	if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) {
		return text;
	}
	const bytes: number[] = [];
	const body = text.slice(1, -1);
	for (let at = 0; at < body.length; at++) {
		const char = body[at] ?? "";
		if (char !== "\\") {
			bytes.push(...Buffer.from(char, "utf8"));
			continue;
		}
		const next = body[at + 1] ?? "";
		const octal = /^[0-7]{3}/.exec(body.slice(at + 1));
		if (octal) {
			bytes.push(Number.parseInt(octal[0], 8));
			at += 3;
		} else {
			bytes.push(...Buffer.from(ESCAPES[next] ?? next, "utf8"));
			at += 1;
		}
	}
	return Buffer.from(bytes).toString("utf8");
}

function byteLength(text: string): number {
	return Buffer.byteLength(text, "utf8");
}

/** The first `bytes` bytes of `text`; a character they cut is dropped. */
function cutToBytes(text: string, bytes: number): string {
	return Buffer.from(text, "utf8")
		.subarray(0, bytes)
		.toString("utf8")
		.replace(/�$/, "");
}

/** `text` without its last line, which a cut left partial. */
function withoutLastLine(text: string): string {
	const end = text.lastIndexOf("\n");
	return end < 0 ? "" : text.slice(0, end);
}
