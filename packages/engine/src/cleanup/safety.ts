import type { RunBranchState, RunCopyState } from "../projects";

/**
 * What the cleanup keeps of what a run left on this computer, and when.
 * Pure: the facts come from `projects/run-branches.ts`.
 *
 * A run's copy of the project and its local branches go a day after the
 * run ended (`RUN_COPY_DAYS`). Work that is only on this computer stays
 * first, out of sight (`workToKeep`), until `cleanUpAfterDays` after the
 * run ended. A worktree git does not know is never removed: only git
 * removes a worktree, and git would not.
 */

const DAY_MS = 24 * 60 * 60_000;

/** How many days after a run ended its copy of the project and its branches go. */
export const RUN_COPY_DAYS = 1;

/** Whether the run left anything on this computer: a worktree folder, one git still lists, or a branch. */
export function hasLeftovers(state: RunCopyState): boolean {
	return state.exists || state.registered || state.branches.length > 0;
}

/**
 * Why the cleanup leaves the run's copy as it is now, or null when it
 * may go: git does not know the folder, or git could not tell what is in
 * it.
 */
export function whyLeave(state: RunCopyState): string | null {
	if (!state.exists) return null;
	if (!state.registered) return "git does not know its folder";
	if (state.changes === null || state.head === null) {
		return "git could not tell what is in it";
	}
	return null;
}

/**
 * What of the run to keep before its copy and branches go: its copy when
 * it holds work that is only here (changes that are not committed, or
 * commits only here), and each branch with commits only here. A branch
 * whose work is merged (also by a squash or a rebase) or pushed needs
 * nothing.
 */
export function workToKeep(state: RunCopyState): {
	copy: boolean;
	branches: RunBranchState[];
} {
	return {
		copy:
			state.exists &&
			state.head !== null &&
			((state.changes ?? 0) > 0 || state.head.unsaved > 0),
		branches: state.branches.filter((branch) => branch.unsaved > 0),
	};
}

/**
 * When the cleanup may remove what a run left: `afterDays` after it
 * ended (or started, when it has no end).
 */
export function cleanupTime(
	run: { createdAt: number; endedAt: number | null },
	afterDays: number,
): number {
	return (run.endedAt ?? run.createdAt) + afterDays * DAY_MS;
}

/**
 * When the scheduled cleanup may remove the run folder of a run this
 * computer does not know: `afterDays` after its last change.
 */
export function lastChangeCleanupTime(
	lastChange: number,
	afterDays: number,
): number {
	return lastChange + afterDays * DAY_MS;
}
