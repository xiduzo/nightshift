import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Refusal } from "@nightshift/refusal";

import { type Git, gitOrThrow, systemGit } from "./git";

/**
 * Clones and run worktrees over the git port (`git.ts`). A run's worktree
 * lives in a sibling directory of the user's clone:
 * `<parent>/<repo>.nightshift/<short>`. Nothing here deletes a worktree:
 * `run-branches.ts` removes them, when `cleanup/` says so. A run whose
 * copy went gets it back at its place (`restoreWorktree`), from its
 * branch, the work the cleanup kept (`keptRefsOf`), origin, or its base.
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

/**
 * Where the cleanup keeps the work of ended runs that is only on this
 * computer, once their copy and their branches went (`cleanup/`): refs
 * outside `refs/heads/`, so `git branch` does not list them.
 */
export const KEPT_REFS = "refs/nightshift/kept/";

/**
 * The kept refs of one run, all under `prefix`: `copy` is the state of
 * its copy of the project when it went, with its uncommitted changes as
 * one commit on top. `branch(name)` is a branch of the run as it was:
 * `refs/nightshift/kept/<short>/heads/nightshift/<short>`.
 */
export function keptRefsOf(shortId: string) {
	const prefix = `${KEPT_REFS}${shortId}/`;
	return {
		prefix,
		copy: `${prefix}copy`,
		branch: (name: string) => `${prefix}heads/${name}`,
	};
}

/**
 * What `restoreWorktree` made the run's copy again from: the run's
 * branch on this computer, the work the cleanup kept, the run's branch on
 * origin, or the commit the run started from.
 */
export type RestoredFrom = "branch" | "kept" | "origin" | "base";

/** The branches of a clone, newest commit first. */
export type Branches = {
	/** The checked-out branch, or null when HEAD is detached. */
	current: string | null;
	local: string[];
	/** As `origin/main`, without the remotes' `HEAD`. */
	remote: string[];
};

/** How long fetching a run's base branch may take before the run starts without it. */
export const BASE_FETCH_TIMEOUT_MS = 30_000;

/** The run's warning when the fetch of its base branch failed. */
export function baseNotFetched(branch: string): string {
	return `Night Shift could not get the newest ${branch}. This run starts from the ${branch} on the run's computer.`;
}

/** The run's warning when its base branch and the remote's went apart. */
export function baseDiverged(branch: string): string {
	return `The newest ${branch} and the ${branch} on the run's computer have different commits. This run starts from the one on the run's computer.`;
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

export class DirtyWorktreeError extends Refusal {
	constructor(message: string) {
		// Words for the person: the step that fails shows them as they are.
		super("conflict", message);
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
			throw new Refusal("invalid", `The folder ${path} does not exist.`);
		}
		const result = await git.run(real, ["rev-parse", "--show-toplevel"]);
		if (result.exitCode !== 0 || !result.stdout) {
			throw new Refusal(
				"invalid",
				`${path} is not a git repository. Pick the folder of a git clone.`,
			);
		}
		const topLevel = await realpath(result.stdout);
		if (topLevel !== real) {
			throw new Refusal(
				"invalid",
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
			throw new Refusal(
				"invalid",
				`The branch or commit "${ref}" does not exist in this project.`,
			);
		}
		return result.stdout;
	}

	/** Whether the full ref `ref` exists (`refs/heads/main`, `refs/remotes/origin/main`). */
	async function refExists(cwd: string, ref: string): Promise<boolean> {
		const result = await git.run(cwd, [
			"rev-parse",
			"--verify",
			"--quiet",
			ref,
		]);
		return result.exitCode === 0;
	}

	/** A git config value of the clone, or null when it has none. */
	async function configValue(cwd: string, key: string): Promise<string | null> {
		const result = await git.run(cwd, ["config", "--get", key]);
		return result.exitCode === 0 && result.stdout ? result.stdout : null;
	}

	/**
	 * Where the newest commit of a base ref is, when the ref is a branch that
	 * a remote has too: `remote` and its `branch`. A local branch fetches
	 * from its upstream, else from `origin` when `origin/<name>` is known. A
	 * remote-tracking branch (`origin/main`) fetches itself. Null for
	 * anything else: a commit, a tag, `HEAD~1`, a branch only this clone has.
	 */
	async function remoteOfBase(
		repoPath: string,
		ref: string,
	): Promise<{ remote: string; branch: string; label: string } | null> {
		const name = ref.replace(/^refs\/heads\//, "");
		if (await refExists(repoPath, `refs/heads/${name}`)) {
			const remote = await configValue(repoPath, `branch.${name}.remote`);
			const merge = await configValue(repoPath, `branch.${name}.merge`);
			if (remote && remote !== "." && merge?.startsWith("refs/heads/")) {
				return { remote, branch: merge.slice(11), label: name };
			}
			if (await refExists(repoPath, `refs/remotes/origin/${name}`)) {
				return { remote: "origin", branch: name, label: name };
			}
			return null;
		}
		const tracking = ref.replace(/^refs\/remotes\//, "");
		if (!(await refExists(repoPath, `refs/remotes/${tracking}`))) return null;
		const remotes = await git.run(repoPath, ["remote"]);
		if (remotes.exitCode !== 0) return null;
		for (const remote of remotes.stdout.split("\n").filter(Boolean)) {
			if (tracking.startsWith(`${remote}/`)) {
				const branch = tracking.slice(remote.length + 1);
				return { remote, branch, label: tracking };
			}
		}
		return null;
	}

	/** Whether `ancestor` is `commit` or comes before it. */
	async function isAncestor(
		cwd: string,
		ancestor: string,
		commit: string,
	): Promise<boolean> {
		const result = await git.run(cwd, [
			"merge-base",
			"--is-ancestor",
			ancestor,
			commit,
		]);
		return result.exitCode === 0;
	}

	/**
	 * The commit a run starts from, for `ref`. A branch that a remote has
	 * too is fetched first (`BASE_FETCH_TIMEOUT_MS`, never a prompt), so a
	 * merge on the remote reaches the next run: it starts at the newest
	 * commit, unless the clone's branch has commits the remote lacks. Then
	 * the clone's branch wins (a person's work that is not pushed), with a
	 * warning when the two went apart. A fetch that fails starts from the
	 * clone's branch, with a warning; it never stops the run. The fetch
	 * writes only a ref of its own, removed after: the person's branches,
	 * their remote-tracking branches and their checkout stay as they are.
	 */
	async function startCommit(
		repoPath: string,
		ref: string,
		shortId: string,
	): Promise<{ commit: string; warning: string | null }> {
		const local = await resolveCommit(repoPath, ref);
		const source = await remoteOfBase(repoPath, ref);
		if (!source) return { commit: local, warning: null };
		const fetched = `refs/nightshift/base/${shortId}`;
		try {
			const result = await git.run(
				repoPath,
				[
					"fetch",
					"--quiet",
					"--no-tags",
					"--no-write-fetch-head",
					// No update of `origin/<branch>` on the side: two starts at once
					// would race for its lock, and the person's refs stay theirs.
					"--refmap=",
					source.remote,
					`+refs/heads/${source.branch}:${fetched}`,
				],
				{
					timeoutMs: BASE_FETCH_TIMEOUT_MS,
					env: { GIT_TERMINAL_PROMPT: "0" },
				},
			);
			const newest =
				result.exitCode === 0 && !result.timedOut
					? await git.run(repoPath, [
							"rev-parse",
							"--verify",
							"--quiet",
							`${fetched}^{commit}`,
						])
					: null;
			const remote = newest?.exitCode === 0 ? newest.stdout : "";
			if (!remote) {
				console.warn(
					`[projects] fetching ${source.branch} from ${source.remote} for a run failed${result.timedOut ? " (timed out)" : ""}: ${result.stderr}`,
				);
				return { commit: local, warning: baseNotFetched(source.label) };
			}
			if (remote === local || (await isAncestor(repoPath, local, remote))) {
				return { commit: remote, warning: null };
			}
			if (await isAncestor(repoPath, remote, local)) {
				return { commit: local, warning: null };
			}
			return { commit: local, warning: baseDiverged(source.label) };
		} catch (error) {
			// Git could not start: the worktree below says so.
			console.warn(`[projects] fetching a run's base failed: ${error}`);
			return { commit: local, warning: baseNotFetched(source.label) };
		} finally {
			await git.run(repoPath, ["update-ref", "-d", fetched]).catch(() => {});
		}
	}

	/**
	 * Adds a worktree on a new branch `nightshift/<shortId>` from `baseRef`
	 * (default: the clone's current HEAD). Returns the resolved base commit.
	 * A branch base ref starts at its newest commit (`startCommit`), and
	 * `warning` says when it could not. With `author`, the worktree gets that
	 * git identity in its own config.
	 */
	async function createWorktree(input: {
		repoPath: string;
		shortId: string;
		baseRef?: string;
		author?: { name: string; email: string };
	}): Promise<{
		worktreePath: string;
		branch: string;
		baseRef: string;
		warning?: string;
	}> {
		const start =
			input.baseRef === undefined
				? {
						commit: await resolveCommit(input.repoPath, "HEAD"),
						warning: null,
					}
				: await startCommit(input.repoPath, input.baseRef, input.shortId);
		const baseRef = start.commit;
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
		return {
			worktreePath,
			branch,
			baseRef,
			...(start.warning ? { warning: start.warning } : {}),
		};
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
		restoreWorktree,
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
	restoreWorktree,
} = createWorktrees(systemGit());

/** Runs git in `cwd` on this computer (`systemGit().run`). For tests. */
export const git = systemGit().run;
