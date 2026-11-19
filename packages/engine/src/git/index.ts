/** The git port (`Git`), the clones and run worktrees over it, the branches of ended runs, and the snapshots that tell what a step changed in a worktree. */

export {
	type Git,
	type GitInstall,
	GitNotInstalledError,
	type GitResult,
	type GitRunOptions,
	gitOrThrow,
	runProcess,
	systemGit,
	systemGitInstaller,
} from "./git";
export {
	createRunBranches,
	type RunBranches,
	type RunBranchState,
	type RunCopyState,
} from "./run-branches";
export { createWorktreeSnapshots } from "./worktree-changes";
export {
	type Branches,
	keptRefsOf,
	type RestoredFrom,
	worktreeLocation,
} from "./worktree-places";
export { createWorktrees } from "./worktrees";
