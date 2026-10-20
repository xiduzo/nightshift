/** Projects, their Clones and the Space document that defines them, the git port, the git setup of a project folder, and run worktrees. */

export type { Git, GitInstall } from "./git";
export { systemGit, systemGitInstaller } from "./git";
export type { ProjectReadiness } from "./project-setup";
export { checkProjectFolder, setUpGit } from "./project-setup";
export type { ListedProject, Project } from "./projects";
export {
	clonePathOf,
	createProjects,
	NOT_ON_THIS_COMPUTER,
	toProject,
} from "./projects";
export type { SpaceDocument, SpaceDocuments } from "./space-document";
export {
	createSpaceDocuments,
	deviceNameIn,
	memberRole,
	projectClones,
	recordClone,
	spaceDocumentName,
	spaceIdOf,
} from "./space-document";
export type { Branches } from "./worktrees";
export {
	createWorktrees,
	itemBranchName,
	worktreeLocation,
} from "./worktrees";
