/** Projects, their Clones on this computer and the git setup of a project folder. The Space document that defines them is in `documents/space/`. */

export { cloneRowsOfDevice } from "./device-rows";
export { projectSpaceOf } from "./project-rows";
export { checkProjectFolder } from "./project-setup";
export type { ListedProject, Project, Projects } from "./projects";
export {
	createProjects,
	NOT_ON_THIS_COMPUTER,
	PROJECT_NOT_FOUND,
	toProject,
} from "./projects";
