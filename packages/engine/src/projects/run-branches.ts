import { realpath, stat } from "node:fs/promises";

import { type Git, gitOrThrow } from "./git";
import { worktreeLocation } from "./worktrees";

/**
 * What a run left in a project's clone on this computer: its worktree
 * (`<repo>.nightshift/<short>`), its branch `nightshift/<short>` and the
 * Item Branches `nightshift/<short>-…`, with how far each branch's work is
 * kept elsewhere. Over the git port, as git knows it now: nothing here
 * fetches. And the three removals: a worktree, a local branch, and
 * `git worktree prune`. Nothing here ever touches a remote branch.
 *
 * Which removal is safe is not decided here: `cleanup/` decides it from
 * these facts.
 */

/** One local branch of a run, and where its commits are kept. */
export type RunBranchState = {
	name: string;
	/** Every commit of the branch is in the project's default branch (local or on origin). */
	merged: boolean;
	/** `origin/<name>` exists, as git knows it now. */
	pushed: boolean;
	/** Commits on the branch that `origin/<name>` lacks. Null when it is not pushed. */
	ahead: number | null;
	/**
	 * Commits that are only here: in no branch on origin, not in the
	 * local default branch, and not in the commit the run started from.
	 * Deleting the branch loses them.
	 */
	unsaved: number;
};

/** A run's worktree and branches in one clone on this computer. */
export type RunCopyState = {
	/** Where the run's worktree is, or was, on this computer. */
	worktreePath: string;
	/** The folder exists. */
	exists: boolean;
	/** Git lists the folder as a worktree of the clone. */
	registered: boolean;
	/**
	 * Changed, staged and untracked files in the worktree: 0 without one,
	 * null when git could not tell.
	 */
	changes: number | null;
	branches: RunBranchState[];
};

/** A run as the inspection needs it: its short id and the commit it started from. */
export type RunRef = { shortId: string; baseRef: string };

export type RunBranches = ReturnType<typeof createRunBranches>;

/** The run branches and worktrees of clones, over the git port. */
export function createRunBranches(git: Git) {
	async function refExists(cwd: string, ref: string): Promise<boolean> {
		const result = await git.run(cwd, [
			"rev-parse",
			"--verify",
			"--quiet",
			ref,
		]);
		return result.exitCode === 0;
	}

	/**
	 * The project's default branch: the one `origin/HEAD` names, else
	 * `main`, else `master`. Null when the clone has none of them. `refs`
	 * are its local and origin refs that exist.
	 */
	async function defaultBranch(
		repoPath: string,
	): Promise<{ name: string; refs: string[] } | null> {
		const head = await git.run(repoPath, [
			"symbolic-ref",
			"-q",
			"refs/remotes/origin/HEAD",
		]);
		const candidates =
			head.exitCode === 0 && head.stdout.startsWith("refs/remotes/origin/")
				? [head.stdout.slice("refs/remotes/origin/".length)]
				: ["main", "master"];
		for (const name of candidates) {
			const refs: string[] = [];
			for (const ref of [`refs/heads/${name}`, `refs/remotes/origin/${name}`]) {
				if (await refExists(repoPath, ref)) refs.push(ref);
			}
			if (refs.length > 0) return { name, refs };
		}
		return null;
	}

	/** The worktrees git lists for the clone, by their real path. */
	async function listWorktrees(repoPath: string): Promise<Set<string>> {
		const out = await gitOrThrow(git, repoPath, [
			"worktree",
			"list",
			"--porcelain",
		]);
		const paths = new Set<string>();
		for (const line of out.split("\n")) {
			if (!line.startsWith("worktree ")) continue;
			const path = line.slice("worktree ".length);
			paths.add(path);
			paths.add(await realpath(path).catch(() => path));
		}
		return paths;
	}

	/** Local branches under `nightshift/`, and the ones origin has, as git knows it now. */
	async function nightshiftRefs(repoPath: string) {
		const out = await gitOrThrow(git, repoPath, [
			"for-each-ref",
			"--format=%(refname)",
			"refs/heads/nightshift/",
			"refs/remotes/origin/nightshift/",
		]);
		const local: string[] = [];
		const remote = new Set<string>();
		for (const ref of out.split("\n")) {
			if (ref.startsWith("refs/heads/")) local.push(ref.slice(11));
			else if (ref.startsWith("refs/remotes/origin/"))
				remote.add(ref.slice(20));
		}
		return { local, remote };
	}

	async function count(cwd: string, args: string[]): Promise<number> {
		const out = await gitOrThrow(git, cwd, ["rev-list", "--count", ...args]);
		return Number(out) || 0;
	}

	/** Whether a path is a folder. */
	async function isFolder(path: string): Promise<boolean> {
		return (await stat(path).catch(() => null))?.isDirectory() ?? false;
	}

	/**
	 * What each run left in the clone at `repoPath`: its worktree and its
	 * branches, by short id. One listing of the clone serves every run.
	 */
	async function inspect(
		repoPath: string,
		runs: readonly RunRef[],
	): Promise<{
		defaultBranch: string | null;
		runs: Map<string, RunCopyState>;
	}> {
		const [main, worktrees, refs] = await Promise.all([
			defaultBranch(repoPath),
			listWorktrees(repoPath),
			nightshiftRefs(repoPath),
		]);
		const localDefault = main?.refs.find((ref) =>
			ref.startsWith("refs/heads/"),
		);
		const states = new Map<string, RunCopyState>();
		for (const run of runs) {
			const { worktreePath, branch } = worktreeLocation(repoPath, run.shortId);
			const exists = await isFolder(worktreePath);
			const real = exists
				? await realpath(worktreePath).catch(() => worktreePath)
				: worktreePath;
			const registered = worktrees.has(worktreePath) || worktrees.has(real);
			let changes: number | null = 0;
			if (exists) {
				const status = registered
					? await git.run(worktreePath, ["status", "--porcelain"])
					: null;
				changes =
					status?.exitCode === 0
						? status.stdout.split("\n").filter(Boolean).length
						: null;
			}
			const names = refs.local.filter(
				(name) => name === branch || name.startsWith(`${branch}-`),
			);
			// The commit the run started from, when this clone has it: its history is not the run's work.
			const base =
				names.length > 0 &&
				(await refExists(repoPath, `${run.baseRef}^{commit}`))
					? [run.baseRef]
					: [];
			const branches: RunBranchState[] = [];
			for (const name of names) {
				const ref = `refs/heads/${name}`;
				const pushed = refs.remote.has(name);
				branches.push({
					name,
					merged: main
						? (await count(repoPath, [ref, "--not", ...main.refs])) === 0
						: false,
					pushed,
					ahead: pushed
						? await count(repoPath, [`refs/remotes/origin/${name}..${ref}`])
						: null,
					unsaved: await count(repoPath, [
						ref,
						"--not",
						"--remotes=origin",
						...(localDefault ? [localDefault] : []),
						...base,
					]),
				});
			}
			states.set(run.shortId, {
				worktreePath,
				exists,
				registered,
				changes,
				branches,
			});
		}
		return { defaultBranch: main?.name ?? null, runs: states };
	}

	/**
	 * `git worktree remove`: git refuses a worktree with changes unless
	 * `force`. Then `git worktree prune` forgets worktrees whose folder is
	 * gone.
	 */
	async function removeWorktree(
		repoPath: string,
		worktreePath: string,
		options: { force?: boolean } = {},
	): Promise<void> {
		await gitOrThrow(git, repoPath, [
			"worktree",
			"remove",
			...(options.force ? ["--force"] : []),
			worktreePath,
		]);
		await prune(repoPath);
	}

	/**
	 * Deletes a local branch with `git branch -D`. `-d` would judge by the
	 * clone's checked-out branch and refuse a branch that is only pushed:
	 * the caller has checked where its commits are kept, or the person
	 * confirmed. Never a remote branch.
	 */
	async function deleteBranch(repoPath: string, name: string): Promise<void> {
		await gitOrThrow(git, repoPath, ["branch", "-D", "--", name]);
	}

	/** `git worktree prune`: forgets the worktrees whose folder is gone. */
	async function prune(repoPath: string): Promise<void> {
		await gitOrThrow(git, repoPath, ["worktree", "prune"]);
	}

	return { defaultBranch, inspect, removeWorktree, deleteBranch, prune };
}
