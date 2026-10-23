import type { RunCopyState } from "../projects";

/**
 * What is safe to remove of what a run left on this computer. Pure: the
 * facts come from `projects/run-branches.ts`.
 *
 * Safe means nothing is lost: every commit of every branch of the run is
 * in the default branch or on origin (or in the commit it started from),
 * and its worktree has no changes that are not committed. A worktree git
 * does not know is never safe: only git removes a worktree, and git would
 * not.
 */

const DAY_MS = 24 * 60 * 60_000;

/** Whether the run left anything on this computer: a worktree folder, one git still lists, or a branch. */
export function hasLeftovers(state: RunCopyState): boolean {
	return state.exists || state.registered || state.branches.length > 0;
}

/** Commits on the run's branches that are only on this computer. */
export function unsavedCommits(state: RunCopyState): number {
	return state.branches.reduce((sum, branch) => sum + branch.unsaved, 0);
}

/** Removing the run's worktree and deleting its local branches loses nothing. */
export function isSafeToRemove(state: RunCopyState): boolean {
	if (state.exists && !state.registered) return false;
	return state.changes === 0 && unsavedCommits(state) === 0;
}

/**
 * When the scheduled cleanup may remove a run's leftovers: `afterDays`
 * after it ended (or started, when it has no end).
 */
export function cleanupTime(
	run: { createdAt: number; endedAt: number | null },
	afterDays: number,
): number {
	return (run.endedAt ?? run.createdAt) + afterDays * DAY_MS;
}
