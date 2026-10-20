import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { type Git, gitOrThrow, systemGit } from "./git";

/**
 * Clones and run worktrees over the git port (`git.ts`). A run's worktree
 * lives in a sibling directory of the user's clone:
 * `<parent>/<repo>.nightshift/<short>`. Nothing here deletes a worktree.
 */

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

/** The branches of a clone, newest commit first. */
export type Branches = {
	/** The checked-out branch, or null when HEAD is detached. */
	current: string | null;
	local: string[];
	/** As `origin/main`, without the remotes' `HEAD`. */
	remote: string[];
};

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

export class DirtyWorktreeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DirtyWorktreeError";
	}
}

/** The changes that block a hand-off, for its message: up to five files. */
function changesShown(changes: readonly string[]): string {
	const shown = changes
		.slice(0, 5)
		.map((line) => line.slice(3))
		.join(", ");
	return changes.length > 5 ? `${shown} and ${changes.length - 5} more` : shown;
}

/** The git operations on clones and run worktrees. */
export type Worktrees = ReturnType<typeof createWorktrees>;

/** The git operations on clones and run worktrees, over the git port. */
export function createWorktrees(git: Git) {
	/**
	 * Returns the canonical path of the repository when `path` is the top level
	 * of a git working tree. Throws otherwise.
	 */
	async function resolveRepoTopLevel(path: string): Promise<string> {
		let real: string;
		try {
			real = await realpath(path);
		} catch {
			throw new Error(`The folder ${path} does not exist.`);
		}
		const result = await git.run(real, ["rev-parse", "--show-toplevel"]);
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

	/** The URL of the repository's `origin` remote as git gives it, or null without one. */
	async function originUrl(repoPath: string): Promise<string | null> {
		const result = await git.run(repoPath, ["remote", "get-url", "origin"]);
		return result.exitCode === 0 && result.stdout ? result.stdout : null;
	}

	/** Resolves a ref (default `HEAD`) to a full commit id. */
	async function resolveCommit(
		repoPath: string,
		ref = "HEAD",
	): Promise<string> {
		const result = await git.run(repoPath, [
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

	/**
	 * Adds a worktree on a new branch `nightshift/<shortId>` from `baseRef`
	 * (default: the clone's current HEAD). Returns the resolved base commit.
	 * With `author`, the worktree gets that git identity in its own config.
	 */
	async function createWorktree(input: {
		repoPath: string;
		shortId: string;
		baseRef?: string;
		author?: { name: string; email: string };
	}): Promise<{ worktreePath: string; branch: string; baseRef: string }> {
		const baseRef = await resolveCommit(
			input.repoPath,
			input.baseRef ?? "HEAD",
		);
		const { worktreePath, branch } = worktreeLocation(
			input.repoPath,
			input.shortId,
		);
		await mkdir(dirname(worktreePath), { recursive: true });
		await gitOrThrow(git, input.repoPath, [
			"worktree",
			"add",
			"-b",
			branch,
			worktreePath,
			baseRef,
		]);
		if (input.author) await setWorktreeAuthor(worktreePath, input.author);
		return { worktreePath, branch, baseRef };
	}

	/**
	 * Gives one worktree its own `user.name` and `user.email`: commits in it
	 * are in that Person's name, and the clone and its other worktrees keep
	 * theirs. Per-worktree config needs `extensions.worktreeConfig`, which this
	 * turns on in the clone (as `git sparse-checkout` does); git ignores the
	 * worktree's own file without it.
	 */
	async function setWorktreeAuthor(
		worktreePath: string,
		author: { name: string; email: string },
	): Promise<void> {
		await gitOrThrow(git, worktreePath, [
			"config",
			"extensions.worktreeConfig",
			"true",
		]);
		await gitOrThrow(git, worktreePath, [
			"config",
			"--worktree",
			"user.name",
			author.name,
		]);
		await gitOrThrow(git, worktreePath, [
			"config",
			"--worktree",
			"user.email",
			author.email,
		]);
	}

	/** The checked-out branch of a worktree, or null when HEAD is detached. */
	async function currentBranch(cwd: string): Promise<string | null> {
		const result = await git.run(cwd, [
			"symbolic-ref",
			"--short",
			"-q",
			"HEAD",
		]);
		return result.exitCode === 0 && result.stdout ? result.stdout : null;
	}

	/** The local and remote-tracking branches of a clone, as git knows them now (no fetch). */
	async function listBranches(cwd: string): Promise<Branches> {
		const refs = await gitOrThrow(git, cwd, [
			"for-each-ref",
			"--sort=-committerdate",
			"--format=%(refname)",
			"refs/heads",
			"refs/remotes",
		]);
		const local: string[] = [];
		const remote: string[] = [];
		for (const ref of refs.split("\n")) {
			if (ref.startsWith("refs/heads/")) local.push(ref.slice(11));
			else if (ref.startsWith("refs/remotes/") && !ref.endsWith("/HEAD"))
				remote.push(ref.slice(13));
		}
		return { current: await currentBranch(cwd), local, remote };
	}

	async function branchExists(cwd: string, name: string): Promise<boolean> {
		const result = await git.run(cwd, [
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
	async function uncommittedChanges(cwd: string): Promise<string[]> {
		const out = await gitOrThrow(git, cwd, ["status", "--porcelain"]);
		return out ? out.split("\n").filter(Boolean) : [];
	}

	/** `name`, or `name-2`, `name-3`, … when a branch of that name exists. */
	async function freeBranchName(cwd: string, name: string): Promise<string> {
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
	async function createAndCheckoutBranch(
		cwd: string,
		branch: string,
		base: string,
	): Promise<void> {
		await refuseDirty(cwd);
		await gitOrThrow(git, cwd, ["checkout", "-q", "-b", branch, base]);
	}

	/** Checks out an existing branch. Refuses a worktree with uncommitted changes. */
	async function checkoutBranch(cwd: string, branch: string): Promise<void> {
		if ((await currentBranch(cwd)) === branch) return;
		await refuseDirty(cwd);
		await gitOrThrow(git, cwd, ["checkout", "-q", branch]);
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

	/**
	 * The sending half of a Hand-off: refuses a worktree with changes that
	 * are not committed (decision 3: nothing is committed for you), then
	 * pushes the checked-out branch, and the run's own branch, to `origin`.
	 * The branches are the run's: a push replaces them.
	 */
	async function pushRunBranch(
		cwd: string,
		runBranch: string,
	): Promise<{ commit: string; branch: string }> {
		const changes = await uncommittedChanges(cwd);
		if (changes.length > 0) {
			throw new DirtyWorktreeError(
				`The run's copy of the project has changes that are not committed (${changesShown(changes)}). Night Shift does not commit for you, so the work cannot move to the next device. Make the step before commit its work.`,
			);
		}
		const branch = (await currentBranch(cwd)) ?? runBranch;
		const commit = await gitOrThrow(git, cwd, ["rev-parse", "HEAD"]);
		const refspecs = [`+HEAD:refs/heads/${branch}`];
		if (branch !== runBranch) {
			refspecs.push(`+refs/heads/${runBranch}:refs/heads/${runBranch}`);
		}
		await gitOrThrow(git, cwd, ["push", "-q", "origin", ...refspecs]);
		return { commit, branch };
	}

	/**
	 * The receiving half of a Hand-off: fetches `branch` from `origin` into
	 * the clone, then checks it out at `commit` in the run's worktree (added
	 * when this clone has none). A worktree it has must be clean.
	 */
	async function pullRunBranch(input: {
		repoPath: string;
		shortId: string;
		branch: string;
		commit: string;
		author?: { name: string; email: string };
	}): Promise<{ worktreePath: string; branch: string; baseRef: string }> {
		const { repoPath, branch, commit } = input;
		await gitOrThrow(git, repoPath, [
			"fetch",
			"-q",
			"origin",
			`+refs/heads/${branch}:refs/remotes/origin/${branch}`,
		]);
		const { worktreePath } = worktreeLocation(repoPath, input.shortId);
		const exists = await stat(worktreePath).catch(() => null);
		if (exists?.isDirectory()) {
			const changes = await uncommittedChanges(worktreePath);
			if (changes.length > 0) {
				throw new DirtyWorktreeError(
					`The run's copy of the project on this device has changes that are not committed (${changesShown(changes)}). Commit or discard them there first.`,
				);
			}
			await gitOrThrow(git, worktreePath, [
				"checkout",
				"-q",
				"-B",
				branch,
				commit,
			]);
		} else {
			await mkdir(dirname(worktreePath), { recursive: true });
			await gitOrThrow(git, repoPath, [
				"worktree",
				"add",
				"-q",
				"-B",
				branch,
				worktreePath,
				commit,
			]);
			if (input.author) await setWorktreeAuthor(worktreePath, input.author);
		}
		return { worktreePath, branch, baseRef: commit };
	}

	return {
		resolveRepoTopLevel,
		originUrl,
		resolveCommit,
		createWorktree,
		setWorktreeAuthor,
		currentBranch,
		listBranches,
		branchExists,
		uncommittedChanges,
		freeBranchName,
		createAndCheckoutBranch,
		checkoutBranch,
		pushRunBranch,
		pullRunBranch,
	};
}

/**
 * The same operations over the git programs on this computer. Tests use
 * them; production code gets its git port injected.
 */
export const {
	resolveRepoTopLevel,
	originUrl,
	resolveCommit,
	createWorktree,
	setWorktreeAuthor,
	currentBranch,
	listBranches,
	branchExists,
	uncommittedChanges,
	freeBranchName,
	createAndCheckoutBranch,
	checkoutBranch,
	pushRunBranch,
	pullRunBranch,
} = createWorktrees(systemGit());

/** Runs git in `cwd` on this computer (`systemGit().run`). For tests. */
export const git = systemGit().run;
