import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/**
 * The git adapter for projects and run worktrees. A run's worktree lives in a
 * sibling directory of the user's clone: `<parent>/<repo>.nightshift/<short>`.
 * Nothing here deletes a worktree.
 */

export class GitError extends Error {
	constructor(
		message: string,
		readonly stderr: string,
	) {
		super(message);
		this.name = "GitError";
	}
}

/** Variables a git hook sets that would point git at the wrong repository. */
const leakingGitVariables = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_PREFIX",
	"GIT_COMMON_DIR",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
];

function gitEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined || leakingGitVariables.includes(key)) continue;
		env[key] = value;
	}
	return env;
}

export async function git(
	cwd: string,
	args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		env: gitEnv(),
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function gitOrThrow(cwd: string, args: string[]): Promise<string> {
	const result = await git(cwd, args);
	if (result.exitCode !== 0) {
		throw new GitError(
			`git ${args.join(" ")} failed: ${result.stderr || `exit code ${result.exitCode}`}`,
			result.stderr,
		);
	}
	return result.stdout;
}

/**
 * Returns the canonical path of the repository when `path` is the top level
 * of a git working tree. Throws otherwise.
 */
export async function resolveRepoTopLevel(path: string): Promise<string> {
	let real: string;
	try {
		real = await realpath(path);
	} catch {
		throw new Error(`The folder ${path} does not exist.`);
	}
	const result = await git(real, ["rev-parse", "--show-toplevel"]);
	if (result.exitCode !== 0 || !result.stdout) {
		throw new Error(
			`${path} is not a git repository. Pick the folder of a git clone.`,
		);
	}
	const topLevel = await realpath(result.stdout);
	if (topLevel !== real) {
		throw new Error(
			`${path} is inside a git repository, but it is not the top folder. Use ${topLevel}.`,
		);
	}
	return topLevel;
}

/** Resolves a ref (default `HEAD`) to a full commit id. */
export async function resolveCommit(
	repoPath: string,
	ref = "HEAD",
): Promise<string> {
	const result = await git(repoPath, [
		"rev-parse",
		"--verify",
		"--quiet",
		`${ref}^{commit}`,
	]);
	if (result.exitCode !== 0 || !result.stdout) {
		throw new Error(
			`The branch or commit "${ref}" does not exist in this project.`,
		);
	}
	return result.stdout;
}

export function worktreeLocation(repoPath: string, shortId: string) {
	return {
		worktreePath: join(
			dirname(repoPath),
			`${basename(repoPath)}.nightshift`,
			shortId,
		),
		branch: `nightshift/${shortId}`,
	};
}

/**
 * Adds a worktree on a new branch `nightshift/<shortId>` from `baseRef`
 * (default: the clone's current HEAD). Returns the resolved base commit.
 */
export async function createWorktree(input: {
	repoPath: string;
	shortId: string;
	baseRef?: string;
}): Promise<{ worktreePath: string; branch: string; baseRef: string }> {
	const baseRef = await resolveCommit(input.repoPath, input.baseRef ?? "HEAD");
	const { worktreePath, branch } = worktreeLocation(
		input.repoPath,
		input.shortId,
	);
	await mkdir(dirname(worktreePath), { recursive: true });
	await gitOrThrow(input.repoPath, [
		"worktree",
		"add",
		"-b",
		branch,
		worktreePath,
		baseRef,
	]);
	return { worktreePath, branch, baseRef };
}

/** The checked-out branch of a worktree, or null when HEAD is detached. */
export async function currentBranch(cwd: string): Promise<string | null> {
	const result = await git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
	return result.exitCode === 0 && result.stdout ? result.stdout : null;
}

export async function branchExists(
	cwd: string,
	name: string,
): Promise<boolean> {
	const result = await git(cwd, [
		"rev-parse",
		"--verify",
		"--quiet",
		`refs/heads/${name}`,
	]);
	return result.exitCode === 0;
}

/**
 * What `git status --porcelain` lists: changed, staged and untracked files.
 * Empty when the worktree is clean.
 */
export async function uncommittedChanges(cwd: string): Promise<string[]> {
	const out = await gitOrThrow(cwd, ["status", "--porcelain"]);
	return out ? out.split("\n").filter(Boolean) : [];
}

/** A git-safe slug: lowercase letters, digits and single dashes. */
export function slugify(text: string, maxChars = 48): string {
	const slug = text
		.normalize("NFKD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.slice(0, maxChars).replace(/-+$/, "");
}

/**
 * `nightshift/<run8>-<id>-<title>`: the branch of one Call item. Not
 * `nightshift/<run8>/…`: git cannot hold a branch inside the name of
 * another, and `nightshift/<run8>` is the run's own branch.
 */
export function itemBranchName(
	shortId: string,
	item: { id: string; title: string },
): string {
	const slug = slugify(`${item.id} ${item.title}`) || "item";
	return `nightshift/${shortId}-${slug}`;
}

/** `name`, or `name-2`, `name-3`, … when a branch of that name exists. */
export async function freeBranchName(
	cwd: string,
	name: string,
): Promise<string> {
	if (!(await branchExists(cwd, name))) return name;
	for (let n = 2; ; n++) {
		const candidate = `${name}-${n}`;
		if (!(await branchExists(cwd, candidate))) return candidate;
	}
}

/**
 * Creates `branch` at `base` and checks it out. Refuses a worktree with
 * uncommitted changes: nothing is committed or stashed on the user's behalf.
 */
export async function createAndCheckoutBranch(
	cwd: string,
	branch: string,
	base: string,
): Promise<void> {
	await refuseDirty(cwd);
	await gitOrThrow(cwd, ["checkout", "-q", "-b", branch, base]);
}

/** Checks out an existing branch. Refuses a worktree with uncommitted changes. */
export async function checkoutBranch(
	cwd: string,
	branch: string,
): Promise<void> {
	if ((await currentBranch(cwd)) === branch) return;
	await refuseDirty(cwd);
	await gitOrThrow(cwd, ["checkout", "-q", branch]);
}

async function refuseDirty(cwd: string): Promise<void> {
	const changes = await uncommittedChanges(cwd);
	if (changes.length === 0) return;
	const shown = changes
		.slice(0, 5)
		.map((line) => line.slice(3))
		.join(", ");
	const more = changes.length > 5 ? ` and ${changes.length - 5} more` : "";
	throw new DirtyWorktreeError(
		`The run's copy of the project has changes that are not committed (${shown}${more}). Night Shift does not commit for you. Make the body flow commit its work.`,
	);
}

export class DirtyWorktreeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DirtyWorktreeError";
	}
}
