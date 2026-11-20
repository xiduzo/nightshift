/** Projects and their Clones: the shared ports (`keep`), a person's requests (`catalog`), and what Night Shift and the Host ask (`clones`, as `Projects`). The git setup of a project folder and the project copies sit beside them. The Space document that defines the Projects is in `documents/space/`. */

export {
	type Catalog,
	type CloneImports,
	type HostRelay,
	wireCatalog,
} from "./catalog";
export { type Projects, wireClones } from "./clones";
export {
	type ListedProject,
	NOT_ON_THIS_COMPUTER,
	type Project,
	wireKeep,
} from "./keep";
export { checkProjectFolder } from "./project-setup";
