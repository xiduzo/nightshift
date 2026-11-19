import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { type Git, gitOrThrow } from "./git";
import {
	BASE_FETCH_TIMEOUT_MS,
	keptRefsOf,
	type RestoredFrom,
	worktreeLocation,
} from "./worktree-places";

/** The operations of `createWorktrees` that the restore of a run's copy uses. */
export type RestoreParts = {
	resolveCommit(repoPath: string, ref?: string): Promise<string>;
	refExists(cwd: string, ref: string): Promise<boolean>;
	isAncestor(cwd: string, ancestor: string, commit: string): Promise<boolean>;
	branchExists(cwd: string, name: string): Promise<boolean>;
	setWorktreeAuthor(
		worktreePath: string,
		author: { name: string; email: string },
	): Promise<void>;
};

/**
 * The run's copy of the project made again at its place (`restoreWorktree`),
 * over the git port and the other worktree operations (`createWorktrees`).
 */
export function createWorktreeRestore(git: Git, parts: RestoreParts) {
	const {
		resolveCommit,
		refExists,
		isAncestor,
		branchExists,
		setWorktreeAuthor,
	} = parts;

	/** The refs under `prefix`, with the commit of each. */
	async function refsUnder(
		cwd: string,
		prefix: string,
	): Promise<Map<string, string>> {
		const out = await gitOrThrow(git, cwd, [
			"for-each-ref",
			"--format=%(objectname) %(refname)",
			prefix,
		]);
		const refs = new Map<string, string>();
		for (const line of out.split("\n").filter(Boolean)) {
			const [commit = "", ref = ""] = line.split(" ");
			refs.set(ref, commit);
		}
		return refs;
	}

	/**
	 * Where the run's copy starts again, in this order:
	 *
	 * 1. The run's branch on this computer: the copy alone went (by hand,
	 *    or the branch stayed). When the kept copy has more (the changes
	 *    the run did not commit), the kept copy.
	 * 2. The kept copy: the cleanup removed the copy and the branch, and
	 *    kept the work that was only here (`keptRefsOf`).
	 * 3. The run's branch on origin, fetched first: the cleanup kept
	 *    nothing because the work was pushed. A Hand-off pushed it too.
	 * 4. The commit the run started from: the work was merged, or there was
	 *    none. The fetch failed, or origin has no such branch.
	 */
	async function restoreStart(input: {
		repoPath: string;
		branch: string;
		keptCopy: string | null;
		baseRef: string;
	}): Promise<{ commit: string; from: RestoredFrom }> {
		const { repoPath, branch, keptCopy } = input;
		if (await branchExists(repoPath, branch)) {
			const tip = await resolveCommit(repoPath, `refs/heads/${branch}`);
			if (keptCopy && (await isAncestor(repoPath, tip, keptCopy))) {
				return { commit: keptCopy, from: "kept" };
			}
			return { commit: tip, from: "branch" };
		}
		if (keptCopy) return { commit: keptCopy, from: "kept" };
		const origin = `refs/remotes/origin/${branch}`;
		const fetched = await git
			.run(
				repoPath,
				[
					"fetch",
					"-q",
					"--no-tags",
					"origin",
					`+refs/heads/${branch}:${origin}`,
				],
				{
					timeoutMs: BASE_FETCH_TIMEOUT_MS,
					env: { GIT_TERMINAL_PROMPT: "0" },
				},
			)
			.catch(() => null);
		if (fetched?.exitCode !== 0) {
			console.warn(
				`[projects] fetching ${branch} from origin to make a run's copy again failed: ${fetched?.stderr ?? ""}`,
			);
		}
		if (await refExists(repoPath, `${origin}^{commit}`)) {
			return { commit: await resolveCommit(repoPath, origin), from: "origin" };
		}
		return {
			commit: await resolveCommit(repoPath, input.baseRef),
			from: "base",
		};
	}

	/**
	 * The run's worktree, made again at its place when the folder `was`
	 * (where the run's log says it is) is gone: a resume or a rerun of a
	 * run whose copy the cleanup removed. Null when that folder is there:
	 * nothing changes. The branches of the run that
	 * the cleanup kept come back first, then the copy starts where
	 * `restoreStart` says, on the run's branch. A kept ref that a branch
	 * has again goes: the work is in sight. One that a branch does not
	 * have stays, until the cleanup removes it.
	 */
	async function restoreWorktree(input: {
		repoPath: string;
		shortId: string;
		/** Where the run's worktree was, as its log says. Default: its place. */
		was?: string;
		/** The commit the run started from. */
		baseRef: string;
		author?: { name: string; email: string };
	}): Promise<{
		worktreePath: string;
		branch: string;
		baseRef: string;
		from: RestoredFrom;
	} | null> {
		const { repoPath, shortId } = input;
		const { worktreePath, branch } = worktreeLocation(repoPath, shortId);
		const was = input.was ?? worktreePath;
		if ((await stat(was).catch(() => null))?.isDirectory()) return null;
		// Git forgets a worktree whose folder is gone: its branch is free again.
		await gitOrThrow(git, repoPath, ["worktree", "prune"]);
		const kept = keptRefsOf(shortId);
		const keptRefs = await refsUnder(repoPath, kept.prefix);
		const heads = `${kept.prefix}heads/`;
		let keptBranch = false;
		for (const [ref, commit] of keptRefs) {
			if (!ref.startsWith(heads)) continue;
			const name = ref.slice(heads.length);
			if (!(await branchExists(repoPath, name))) {
				await gitOrThrow(git, repoPath, ["branch", "--", name, commit]);
				if (name === branch) keptBranch = true;
			}
		}
		const start = await restoreStart({
			repoPath,
			branch,
			keptCopy: keptRefs.get(kept.copy) ?? null,
			baseRef: input.baseRef,
		});
		await mkdir(dirname(worktreePath), { recursive: true });
		await gitOrThrow(
			git,
			repoPath,
			start.from === "branch"
				? ["worktree", "add", "-q", worktreePath, branch]
				: ["worktree", "add", "-q", "-B", branch, worktreePath, start.commit],
		);
		if (input.author) await setWorktreeAuthor(worktreePath, input.author);
		for (const [ref, commit] of keptRefs) {
			const own = ref.startsWith(heads) ? ref.slice(heads.length) : branch;
			if (await isAncestor(repoPath, commit, `refs/heads/${own}`)) {
				await gitOrThrow(git, repoPath, ["update-ref", "-d", ref]);
			}
		}
		// A run's branch that came back from the kept work is kept work.
		const from = start.from === "branch" && keptBranch ? "kept" : start.from;
		return { worktreePath, branch, baseRef: input.baseRef, from };
	}

	return { restoreWorktree };
}
