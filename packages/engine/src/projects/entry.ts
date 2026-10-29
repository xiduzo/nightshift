/**
 * The package entry `@nightshift/engine/projects`: what `devices`, the API
 * and the daemon use of the Projects, their Clones and the Space document,
 * the git setup of a project folder, GitHub clones and project copies. The
 * barrel (`index.ts`) also serves the engine's other verticals, with the
 * Space move's batch and the run worktrees. This entry carries only the
 * names another workspace imports.
 */

export type { GitInstall } from "./git";
export { systemGitInstaller } from "./git";
export type { GitHubAccess, GitHubRepo } from "./github";
export type { GitHubClone, GitHubClones } from "./github-clone";
export { createGitHubClones } from "./github-clone";
export {
	createProjectCopies,
	type ProjectCopies,
	type ProjectCopy,
} from "./project-copies";
export type { ProjectReadiness } from "./project-setup";
export { checkProjectFolder, setUpGit } from "./project-setup";
export type { ListedProject, Project } from "./projects";
export { clonePathOf, PROJECT_NOT_FOUND } from "./projects";
export type { SpaceDocument, SpaceDocuments } from "./space-document";
export {
	createSpaceDocuments,
	deviceNameIn,
	memberName,
	memberRole,
	projectClones,
	recordClone,
} from "./space-document";
export { projectRowsOf, spaceProjectRows } from "./space-rows";
export type { Branches } from "./worktrees";
export { worktreeLocation } from "./worktrees";
