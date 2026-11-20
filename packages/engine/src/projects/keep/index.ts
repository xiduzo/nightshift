/** The ports the requests of the Projects share: the rows, the Space documents, the log, git and the Device directory, with the words and steps they share. `wireKeep` builds the real adapters. */

// Until P3 gives the daemon its own wire: the folder of a Clone here, and whether a project has none.
export {
	clonePathOf,
	withoutFolderOf,
} from "./adapters/out/drizzle-project-store";
export type {
	NewIds,
	ProjectDirectory,
	ProjectLog,
	ProjectStore,
	Repos,
	SpaceProjects,
	ThisDevice,
} from "./application/ports";
export {
	type CloneRecord,
	HOSTED_ELSEWHERE,
	type ListedProject,
	type MovingProject,
	NO_FOLDER,
	NOT_ON_THIS_COMPUTER,
	ownSpace,
	PROJECT_NOT_FOUND,
	type Project,
	type ProjectRecord,
	type ProjectRow,
	type TakenProjects,
} from "./domain/project";
export { normaliseRemote } from "./domain/remote";
export {
	asProjects,
	cloneHere,
	createProject,
	defineProject,
	recordCloneHere,
	restoreProject,
} from "./domain/steps";
export { type Keep, wireKeep } from "./wire";
