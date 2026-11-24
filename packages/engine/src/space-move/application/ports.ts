import type { RowBatch } from "../../contract";
import type {
	MovedRuns,
	ProjectRow,
	ProjectsMoved,
	ProjectTarget,
	RowMove,
} from "../domain/move";

/**
 * The driven ports of the Space move. A port of its own has a real
 * adapter, an in-memory adapter and a contract suite in `adapters/out/`.
 */

/** The rows of a move on this Replica. */
export type MoveStore = {
	/**
	 * The runs of these Projects in the Space: the runs a move of them
	 * takes along. With `walkerId`, only the runs that Walker walks.
	 */
	runIds(
		spaceId: string,
		projectIds: readonly string[],
		walkerId?: string,
	): Promise<string[]>;
	/** The rows of these Projects, in any Space, by id. None: no read. */
	projectRows(ids: readonly string[]): Promise<Map<string, ProjectRow>>;
	/**
	 * The statements that move the Projects' rows from `from` to `to`, in
	 * the order they must run. Reads the Projects first, and throws when
	 * one is not in `from`, or maps onto a Project of another Space or of
	 * another remote.
	 */
	batchOf(move: RowMove): Promise<RowBatch>;
	/** Runs the statements of these batches, in their order, as one batch. None: nothing runs. */
	commit(batches: readonly RowBatch[]): Promise<void>;
	/** Whether the Space's own row is here. */
	spaceExists(spaceId: string): Promise<boolean>;
	/** Whether a Project or a run of the Space is here. */
	holdsRows(spaceId: string): Promise<boolean>;
	/**
	 * Removes the Space's answer costs, then its events that belong to no
	 * run here (a Member that joined).
	 */
	forgetRows(spaceId: string): Promise<void>;
};

/** The Space documents this Replica writes, as a move changes them. */
export type SpaceEntries = {
	/**
	 * The documents follow the moved rows. The Space each Project goes to
	 * gets its entry (from the document it left, else from its row) and
	 * its Clones. The Space they left loses them. `onlyDevice`: only that
	 * Device's Clones go along, and the Space they left keeps them.
	 */
	move(move: {
		from: string;
		projects: Readonly<Record<string, ProjectTarget>>;
		/** The moved Projects' rows as they were before the move. */
		rows: ReadonlyMap<string, ProjectRow>;
		onlyDevice?: string;
	}): Promise<void>;
	/** Removes the Space's document. */
	forget(spaceId: string): Promise<void>;
};

/**
 * What no other request may do while a move runs.
 * @filledBy engine/wire
 */
export type MoveHolds = {
	/** No run becomes active in the Space: resolves with the release, once the starts under way end. */
	holdStarts(spaceId: string): Promise<() => void>;
	/** No schedule of this computer fires: resolves with the release. */
	holdSchedules(): Promise<() => void>;
};

/**
 * This computer as a Walker.
 * @filledBy engine/log
 */
export type ThisWalker = {
	walkerId(): Promise<string>;
};

/**
 * The rows of a package above the engine that move with the runs of a
 * Space move: each gives its statements for the move's batch.
 * @filledBy engine/wire
 */
export type MoveRows = (runs: MovedRuns) => Promise<RowBatch>;

/**
 * The rows of these runs changed under the run log, in a batch that
 * logged nothing: the run log and the landed feed read them again.
 * @filledBy engine/wire
 */
export type Reread = {
	reread(runIds: readonly string[]): void;
};

/**
 * What follows the moved Projects outside the rows, after the batch and
 * the documents: each Project's knowledge.
 * @filledBy engine/wire
 */
export type ProjectsMovedHook = {
	moved?(move: ProjectsMoved): Promise<void>;
};

/**
 * The Projects of a Space, as a person's move of one checks them.
 * @filledBy engine/projects
 */
export type ProjectLookup = {
	/** Refuses (`not-found`) a project that is not in the Space, or that a person removed. */
	find(projectId: string, spaceId: string): Promise<unknown>;
	/**
	 * Refuses a move of the project from `from` to `to`: a Space a Host
	 * keeps, a Space that does not exist, or a project not in `from`.
	 */
	refuseMove(projectId: string, from: string, to: string): Promise<void>;
};

/**
 * The runs of a Project on this computer.
 * @filledBy engine/wire
 */
export type ProjectRuns = {
	/** The ids of the project's runs. */
	runIds(projectId: string): Promise<string[]>;
	/** Whether the run runs a step on this computer now. */
	isActive(runId: string): boolean;
};

/**
 * The fact of a person's move of a Project.
 * @filledBy engine/log
 */
export type MoveLog = {
	projectMoved(move: {
		projectId: string;
		from: string;
		to: string;
	}): Promise<void>;
};
