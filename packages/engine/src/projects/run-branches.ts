import { realpath, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { type Git, GitError, gitOrThrow } from "./git";
import { KEPT_REFS, worktreeLocation } from "./worktrees";

/**
 * What a run left in a project's clone on this computer: its worktree
 * (`<repo>.nightshift/<short>`), its branch `nightshift/<short>`, the
 * Item Branches `nightshift/<short>-…`, and the work the cleanup kept of
 * it under `refs/nightshift/kept/<short>/` (`keptRefsOf`), with how much
 * of each branch's work is only here. Over the git port, as git knows it
 * now: nothing here fetches. And the removals: a worktree, a local
 * branch, a kept ref, and `git worktree prune`. Nothing here ever touches
 * a remote branch.
 *
 * Which removal is safe is not decided here: `cleanup/` decides it from
 * these facts.
 */

/** One local branch of a run, and how much of its work is only here. */
export type RunBranchState = {
	name: string;
	/** Its newest commit. */
	commit: string;
	/**
	 * Commits that are only here (`unsavedCommits`): deleting the branch
	 * loses them. A commit whose change the default branch has (a rebase
	 * merge, a squash merge) is saved.
	 */
	unsaved: number;
};

/** What the run's worktree has checked out. */
export type RunCopyHead = {
	commit: string;
	/**
	 * The checked-out branch: the run's own, an Item Branch, a branch the
	 * run made itself, or null when HEAD is detached.
	 */
	branch: string | null;
	/** Commits of HEAD that are only here, as `RunBranchState.unsaved` counts them. */
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
	/** What the worktree has checked out. Null without a worktree git knows, or when git could not tell. */
	head: RunCopyHead | null;
	/**
	 * Its local branches: the run's own, then its Item Branches. Not a
	 * branch that another worktree has checked out: a person works on it.
	 */
	branches: RunBranchState[];
};

/** A run as the inspection needs it: its short id and the commit it started from. */
export type RunRef = { shortId: string; baseRef: string };

export type RunBranches = ReturnType<typeof createRunBranches>;

/** Who makes the commits that only git reads here: the patch of a squash check, kept changes without a name for git. */
const KEEPER = {
	GIT_AUTHOR_NAME: "Night Shift",
	GIT_AUTHOR_EMAIL: "nightshift@localhost",
	GIT_COMMITTER_NAME: "Night Shift",
	GIT_COMMITTER_EMAIL: "nightshift@localhost",
};

/** The project's default branch, and the refs of it this clone has (local, origin). */
type DefaultBranch = { name: string; refs: string[] };

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
	 * are its origin and local refs that exist, origin first: a pull
	 * request merges there.
	 */
	async function defaultBranch(
		repoPath: string,
	): Promise<DefaultBranch | null> {
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
			for (const ref of [`refs/remotes/origin/${name}`, `refs/heads/${name}`]) {
				if (await refExists(repoPath, ref)) refs.push(ref);
			}
			if (refs.length > 0) return { name, refs };
		}
		return null;
	}

	/**
	 * The worktrees git lists for the clone, by their real path, with the
	 * branch each has checked out.
	 */
	async function listWorktrees(
		repoPath: string,
	): Promise<{ paths: Set<string>; checkedOut: Map<string, string> }> {
		const out = await gitOrThrow(git, repoPath, [
			"worktree",
			"list",
			"--porcelain",
		]);
		const paths = new Set<string>();
		const checkedOut = new Map<string, string>();
		// A worktree whose folder is gone holds no branch: a prune forgets it.
		let current: string | null = null;
		for (const line of out.split("\n")) {
			if (line.startsWith("worktree ")) {
				const path = line.slice("worktree ".length);
				current = await realpath(path).catch(() => null);
				paths.add(path);
				if (current) paths.add(current);
			} else if (line.startsWith("branch refs/heads/") && current) {
				checkedOut.set(line.slice("branch refs/heads/".length), current);
			}
		}
		return { paths, checkedOut };
	}

	/** Local branches under `nightshift/`, with their newest commit. */
	async function nightshiftBranches(
		repoPath: string,
	): Promise<Map<string, string>> {
		const out = await gitOrThrow(git, repoPath, [
			"for-each-ref",
			"--format=%(objectname) %(refname)",
			"refs/heads/nightshift/",
		]);
		const local = new Map<string, string>();
		for (const line of out.split("\n").filter(Boolean)) {
			const [commit = "", ref = ""] = line.split(" ");
			local.set(ref.slice("refs/heads/".length), commit);
		}
		return local;
	}

	/** The kept refs of the clone (`refs/nightshift/kept/<short>/…`), by short id. */
	async function listKept(repoPath: string): Promise<Map<string, string[]>> {
		const out = await gitOrThrow(git, repoPath, [
			"for-each-ref",
			"--format=%(refname)",
			KEPT_REFS,
		]);
		const kept = new Map<string, string[]>();
		for (const ref of out.split("\n").filter(Boolean)) {
			const shortId = ref.slice(KEPT_REFS.length).split("/")[0] ?? "";
			if (shortId === "") continue;
			kept.set(shortId, [...(kept.get(shortId) ?? []), ref]);
		}
		return kept;
	}

	/** The commits of `args` (a `rev-list` range), newest first. */
	async function revList(cwd: string, args: string[]): Promise<string[]> {
		const out = await gitOrThrow(git, cwd, ["rev-list", ...args]);
		return out.split("\n").filter(Boolean);
	}

	/**
	 * The commits of `ref` that `git cherry` finds no change of in
	 * `upstream`: `+` lines. A rebase merge gives the same changes as new
	 * commits, so its commits are `-`.
	 */
	async function notCherryPicked(
		repoPath: string,
		upstream: string,
		ref: string,
	): Promise<Set<string>> {
		const out = await gitOrThrow(git, repoPath, ["cherry", upstream, ref]);
		const left = new Set<string>();
		for (const line of out.split("\n")) {
			if (line.startsWith("+ ")) left.add(line.slice(2));
		}
		return left;
	}

	/**
	 * Whether `upstream` has the whole change of `ref` as one commit: a
	 * squash merge. The commit-tree trick: a throwaway commit with the tree
	 * of `ref` on the merge base, then `git cherry` finds its change in
	 * `upstream` or not. Nothing points at the throwaway commit, so git
	 * drops it. A branch that changes nothing in total is never squashed.
	 */
	async function squashMerged(
		repoPath: string,
		upstream: string,
		ref: string,
	): Promise<boolean> {
		const base = await git.run(repoPath, ["merge-base", upstream, ref]);
		if (base.exitCode !== 0 || !base.stdout) return false;
		const [tree, baseTree] = await Promise.all([
			git.run(repoPath, ["rev-parse", `${ref}^{tree}`]),
			git.run(repoPath, ["rev-parse", `${base.stdout}^{tree}`]),
		]);
		if (tree.exitCode !== 0 || tree.stdout === baseTree.stdout) return false;
		const squashed = await git.run(
			repoPath,
			[
				"commit-tree",
				"--no-gpg-sign",
				"-p",
				base.stdout,
				"-m",
				"squash",
				tree.stdout,
			],
			{ env: KEEPER },
		);
		if (squashed.exitCode !== 0 || !squashed.stdout) return false;
		const cherry = await git.run(repoPath, [
			"cherry",
			upstream,
			squashed.stdout,
		]);
		return cherry.exitCode === 0 && cherry.stdout.startsWith("- ");
	}

	/**
	 * The commits of `ref` that are only here: in no branch on origin, not
	 * in the local default branch, not in `base` (the commit the run started
	 * from), and with no change of theirs in the default branch. A commit
	 * whose change the default branch has came there by a rebase merge or a
	 * squash merge of a pull request: git alone tells it (`git cherry`), no
	 * service is asked.
	 */
	async function unsavedCommits(
		repoPath: string,
		ref: string,
		main: DefaultBranch | null,
		base: readonly string[],
	): Promise<number> {
		const localDefault = main?.refs.find((r) => r.startsWith("refs/heads/"));
		let only = new Set(
			await revList(repoPath, [
				ref,
				"--not",
				"--remotes=origin",
				...(localDefault ? [localDefault] : []),
				...base,
			]),
		);
		if (only.size === 0 || !main) return only.size;
		for (const upstream of main.refs) {
			const left = await notCherryPicked(repoPath, upstream, ref);
			only = new Set([...only].filter((commit) => left.has(commit)));
			if (only.size === 0) return 0;
		}
		for (const upstream of main.refs) {
			if (await squashMerged(repoPath, upstream, ref)) return 0;
		}
		return only.size;
	}

	/** Whether a path is a folder. */
	async function isFolder(path: string): Promise<boolean> {
		return (await stat(path).catch(() => null))?.isDirectory() ?? false;
	}

	/** The commit and the branch the worktree at `cwd` has checked out, or null when git could not tell. */
	async function headOf(
		cwd: string,
	): Promise<{ commit: string; branch: string | null } | null> {
		const commit = await git.run(cwd, ["rev-parse", "--verify", "HEAD"]);
		if (commit.exitCode !== 0 || !commit.stdout) return null;
		const branch = await git.run(cwd, [
			"symbolic-ref",
			"--short",
			"-q",
			"HEAD",
		]);
		return {
			commit: commit.stdout,
			branch: branch.exitCode === 0 && branch.stdout ? branch.stdout : null,
		};
	}

	/**
	 * What each run left in the clone at `repoPath`: its worktree and its
	 * branches, by short id. One listing of the clone serves every run.
	 */
	async function inspect(
		repoPath: string,
		runs: readonly RunRef[],
	): Promise<Map<string, RunCopyState>> {
		const [main, worktrees, local] = await Promise.all([
			defaultBranch(repoPath),
			listWorktrees(repoPath),
			nightshiftBranches(repoPath),
		]);
		const states = new Map<string, RunCopyState>();
		for (const run of runs) {
			const { worktreePath, branch } = worktreeLocation(repoPath, run.shortId);
			const exists = await isFolder(worktreePath);
			const real = exists
				? await realpath(worktreePath).catch(() => worktreePath)
				: worktreePath;
			const registered =
				worktrees.paths.has(worktreePath) || worktrees.paths.has(real);
			let changes: number | null = 0;
			let checkedOut: Awaited<ReturnType<typeof headOf>> = null;
			if (exists) {
				const status = registered
					? await git.run(worktreePath, ["status", "--porcelain"])
					: null;
				changes =
					status?.exitCode === 0
						? status.stdout.split("\n").filter(Boolean).length
						: null;
				if (registered) checkedOut = await headOf(worktreePath);
			}
			const names = [...local.keys()].filter(
				(name) =>
					(name === branch || name.startsWith(`${branch}-`)) &&
					// A branch another worktree has checked out is a person's now.
					(worktrees.checkedOut.get(name) ?? real) === real,
			);
			// The commit the run started from, when this clone has it: its history is not the run's work.
			const base =
				(names.length > 0 || checkedOut) &&
				(await refExists(repoPath, `${run.baseRef}^{commit}`))
					? [run.baseRef]
					: [];
			const branches: RunBranchState[] = [];
			for (const name of names) {
				branches.push({
					name,
					commit: local.get(name) ?? "",
					unsaved: await unsavedCommits(
						repoPath,
						`refs/heads/${name}`,
						main,
						base,
					),
				});
			}
			const head: RunCopyHead | null = checkedOut && {
				...checkedOut,
				unsaved:
					branches.find((b) => b.commit === checkedOut.commit)?.unsaved ??
					(await unsavedCommits(repoPath, checkedOut.commit, main, base)),
			};
			states.set(run.shortId, {
				worktreePath,
				exists,
				registered,
				changes,
				head,
				branches,
			});
		}
		return states;
	}

	/**
	 * Commits the changes of the worktree at `cwd` that are not committed,
	 * without moving any branch: one commit on HEAD with every changed,
	 * staged and new file git does not ignore. Through an index of its own,
	 * so the worktree's index stays as it is. In the name git has for the
	 * worktree, else Night Shift's. Returns the commit.
	 */
	async function commitChanges(cwd: string, message: string): Promise<string> {
		const indexPath = await gitOrThrow(git, cwd, [
			"rev-parse",
			"--git-path",
			"nightshift-kept-index",
		]);
		const index = isAbsolute(indexPath) ? indexPath : join(cwd, indexPath);
		const env = { GIT_INDEX_FILE: index };
		const must = async (args: string[], extra = {}): Promise<string> => {
			const result = await git.run(cwd, args, { env: { ...env, ...extra } });
			if (result.exitCode !== 0) {
				throw new GitError(args, result.exitCode, result.stderr);
			}
			return result.stdout;
		};
		try {
			await must(["read-tree", "HEAD"]);
			await must(["add", "--all"]);
			const tree = await must(["write-tree"]);
			const args = [
				"commit-tree",
				"--no-gpg-sign",
				"-p",
				"HEAD",
				"-m",
				message,
				tree,
			];
			const commit = await git.run(cwd, args, { env });
			if (commit.exitCode === 0 && commit.stdout) return commit.stdout;
			// No name for git here: Night Shift's.
			return await must(args, KEEPER);
		} finally {
			await rm(index, { force: true });
		}
	}

	/** Points the ref `ref` at `commit`: the work of a run stays, out of sight. */
	async function keep(
		repoPath: string,
		ref: string,
		commit: string,
	): Promise<void> {
		await gitOrThrow(git, repoPath, ["update-ref", ref, commit]);
	}

	/** Deletes the ref `ref` (a kept ref). */
	async function deleteRef(repoPath: string, ref: string): Promise<void> {
		await gitOrThrow(git, repoPath, ["update-ref", "-d", ref]);
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
	 * the caller has checked where its commits are kept. Never a remote
	 * branch.
	 */
	async function deleteBranch(repoPath: string, name: string): Promise<void> {
		await gitOrThrow(git, repoPath, ["branch", "-D", "--", name]);
	}

	/** `git worktree prune`: forgets the worktrees whose folder is gone. */
	async function prune(repoPath: string): Promise<void> {
		await gitOrThrow(git, repoPath, ["worktree", "prune"]);
	}

	return {
		defaultBranch,
		inspect,
		listKept,
		commitChanges,
		keep,
		deleteRef,
		removeWorktree,
		deleteBranch,
		prune,
	};
}
