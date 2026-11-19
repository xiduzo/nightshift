/** Projects, their Clones on this computer, the git setup of a project folder, and the rows of a Space move. The Space document that defines them is in `documents/space/`. */

export { moveSpaceEntries, type ProjectTarget } from "./moved-entries";
export { checkProjectFolder } from "./project-setup";
export type { ListedProject, Project, Projects } from "./projects";
export {
	createProjects,
	NOT_ON_THIS_COMPUTER,
	PROJECT_NOT_FOUND,
	toProject,
} from "./projects";
export { forgetSpaceRows, spaceMoveBatch, spaceRunIds } from "./space-rows";
