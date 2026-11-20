/** Copies: clones from GitHub into Night Shift's projects folder, and the copies of the Space's projects to this computer. `wireCopies` binds the use cases to their ports. */

export type { GitHubClones } from "./application/ports";
export {
	type CloneTracker,
	createCloneTracker,
	type GitHubClone,
} from "./domain/clones";
export type { ProjectCopy } from "./domain/copies";
export { type ProjectCopies, wireCopies } from "./wire";
