import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";

/**
 * Where a run's copy of the project lives, and where the cleanup keeps
 * the work of an ended run that was only on this computer.
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

/** The short id of the run whose branch this is (`worktreeLocation`), or null for another branch. */
export function shortIdOfBranch(branch: string): string | null {
	return /^nightshift\/([0-9a-f]{8})$/.exec(branch)?.[1] ?? null;
}

/** Whether the branch is one of the run's names: its own, or that of one of its items. */
export function isRunsBranch(shortId: string, branch: string): boolean {
	const own = worktreeLocation("", shortId).branch;
	return branch === own || branch.startsWith(`${own}-`);
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
 * `refs/nightshift/kept/<short>/heads/nightshift/<short>`. `handed(name)`
 * is the tip the run last handed on, or took, on a branch that is not one of
 * its names: what a Hand-off may replace here (`pullRunBranch`). The
 * cleanup removes it with the rest.
 */
export function keptRefsOf(shortId: string) {
	const prefix = `${KEPT_REFS}${shortId}/`;
	return {
		prefix,
		copy: `${prefix}copy`,
		branch: (name: string) => `${prefix}heads/${name}`,
		// A hash: a branch `a` and a later branch `a/b` both have a ref.
		handed: (name: string) =>
			`${prefix}handed/${createHash("sha256").update(name).digest("hex")}`,
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
