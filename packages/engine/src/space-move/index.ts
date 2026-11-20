/** The Space move: Projects that go from one Space to other Spaces, as one operation (`Engine.moveProjects`). A person's move of a Project, the merge of Personal and its split are each one. `wireSpaceMove` binds the use cases to their ports. */

export type { MoveRows } from "./application/ports";
export type {
	MovedProjects,
	ProjectsMove,
	ProjectsMoved,
} from "./domain/move";
export { type SpaceMove, wireSpaceMove } from "./wire";
