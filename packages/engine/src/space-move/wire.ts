import type { Database } from "@nightshift/db";
import type { SpaceDocuments } from "../documents";
import { drizzleMoveStore } from "./adapters/out/drizzle-move-store";
import { yjsSpaceEntries } from "./adapters/out/yjs-space-entries";
import { forgetSpace } from "./application/forget-space";
import { moveProject } from "./application/move-project";
import { moveProjects } from "./application/move-projects";
import type {
	MovedSchedules,
	MoveHolds,
	MoveLog,
	MoveRows,
	ProjectLookup,
	ProjectRuns,
	ProjectsMovedHook,
	Reread,
	SpaceMoveAccess,
	ThisWalker,
} from "./application/ports";

/**
 * The wiring of the Space move: the one place that builds its real
 * adapters and binds each use case to its ports.
 */

/** What the engine gives the Space move. */
export type SpaceMoveDeps = {
	db: Database;
	access: SpaceMoveAccess;
	documents: Pick<SpaceDocuments, "open" | "remove">;
	holds: MoveHolds;
	walker: ThisWalker;
	movedSchedules: MovedSchedules;
	/** The rows of the packages above the engine, in this order. */
	moveRows: readonly MoveRows[];
	reread: Reread;
	projectsMoved: ProjectsMovedHook;
	projectLookup: ProjectLookup;
	projectRuns: ProjectRuns;
	moveLog: MoveLog;
};

/** The use cases of the Space move, bound to their ports. */
export type SpaceMove = {
	/** Moves Projects from one Space to others, as one operation. */
	moveProjects: ReturnType<typeof moveProjects>;
	/** A person moves a Project of a Space to another Space. */
	moveProject: ReturnType<typeof moveProject>;
	/** Forgets a Space a move emptied. */
	forgetSpace: ReturnType<typeof forgetSpace>;
};

export function wireSpaceMove(deps: SpaceMoveDeps): SpaceMove {
	const ports = {
		access: deps.access,
		...deps,
		moveStore: drizzleMoveStore(deps.db),
		spaceEntries: yjsSpaceEntries(deps.documents),
	};
	return {
		moveProjects: moveProjects(ports),
		moveProject: moveProject(ports),
		forgetSpace: forgetSpace(ports),
	};
}
