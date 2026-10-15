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
		throw new Error(`Not a git repository: ${path} does not exist.`);
	}
	const result = await git(real, ["rev-parse", "--show-toplevel"]);
	if (result.exitCode !== 0 || !result.stdout) {
		throw new Error(`Not a git repository: ${path}`);
	}
	const topLevel = await realpath(result.stdout);
	if (topLevel !== real) {
		throw new Error(
			`${path} is inside a git repository but is not its top level. Use ${topLevel}.`,
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
		throw new Error(`Unknown git ref "${ref}" in ${repoPath}`);
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
