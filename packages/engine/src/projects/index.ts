/** Projects, their Clones and the Space document that defines them, the git port, the git setup of a project folder, run worktrees, and the snapshots that tell what a step changed in one. */

export type { Git } from "./git";
export { systemGit } from "./git";
export { moveSpaceEntries, type ProjectTarget } from "./moved-entries";
export { checkProjectFolder } from "./project-setup";
export type { ListedProject, Project, Projects } from "./projects";
export {
	createProjects,
	NOT_ON_THIS_COMPUTER,
	PROJECT_NOT_FOUND,
	toProject,
} from "./projects";
export {
	createRunBranches,
	type RunBranches,
	type RunBranchState,
	type RunCopyState,
} from "./run-branches";
export type { SpaceDocuments } from "./space-document";
export { createSpaceDocuments, memberName, spaceIdOf } from "./space-document";
export { forgetSpaceRows, spaceMoveBatch, spaceRunIds } from "./space-rows";
export { createWorktreeSnapshots } from "./worktree-changes";
export type { Branches } from "./worktrees";
export { createWorktrees, itemBranchName } from "./worktrees";
