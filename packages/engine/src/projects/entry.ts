/**
 * The package entry `@nightshift/engine/projects`: what `devices`, the API
 * and the daemon use of the Projects, their Clones and the Space document,
 * the git setup of a project folder, GitHub clones and project copies. The
 * barrel (`index.ts`) also serves the engine's other verticals, with the
 * Space move's batch and the run worktrees. This entry carries only the
 * names another workspace imports.
 */

export type { SpaceDocument, SpaceDocuments } from "../documents";
export {
	createSpaceDocuments,
	deviceNameIn,
	memberName,
	memberRole,
} from "../documents";
export type { Branches, GitInstall } from "../git";
export { systemGitInstaller, worktreeLocation } from "../git";
export type { GitHubAccess, GitHubRepo } from "../github";
export { systemGitHubCli } from "../github";
export type { GitHubClone, GitHubClones } from "./github-clone";
export { createGitHubClones } from "./github-clone";
export {
	clonePathOf,
	type ListedProject,
	PROJECT_NOT_FOUND,
	type Project,
	type TakenProjects,
	withoutFolderOf,
} from "./keep";
export {
	createProjectCopies,
	type ProjectCopies,
	type ProjectCopy,
} from "./project-copies";
export type { ProjectReadiness } from "./project-setup";
export { checkProjectFolder, setUpGit } from "./project-setup";
