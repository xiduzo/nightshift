/** Projects and their Clones: the shared ports (`keep`), a person's requests (`catalog`), what Night Shift and the Host ask (`clones`, as `Projects`), the setup of a project folder (`setup`) and the copies from GitHub (`copies`). The package entry `@nightshift/engine/projects` is this barrel. The Space document that defines the Projects is in `documents/space/`. */

export {
	type Catalog,
	type HostRelay,
	wireCatalog,
} from "./catalog";
export { type Projects, wireClones } from "./clones";
export {
	type CloneTracker,
	createCloneTracker,
	type GitHubAsks,
	type GitHubClone,
	type ProjectCopies,
	type ProjectCopy,
	wireCopies,
} from "./copies";
export {
	type ListedProject,
	PROJECT_NOT_FOUND,
	type Project,
	type TakenProjects,
	wireKeep,
} from "./keep";
export { type ProjectReadiness, type Setup, wireSetup } from "./setup";
