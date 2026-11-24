import type { Schedule } from "@nightshift/flows";
import type { RowBatch } from "../../contract";

/**
 * The words and shapes of a Space move: Projects that go from one Space
 * to other Spaces, as one operation (`Engine.moveProjects`). A person's
 * move of a Project, the merge of a Device's Personal into its Home
 * Host's, and the split of a Personal of its own when it leaves (ADR 1)
 * are each one.
 */

/** Where a moved Project goes: its Space, and its id there. */
export type ProjectTarget = { spaceId: string; projectId: string };

/** What moves, as the caller decides it under the hold. */
export type ProjectsMovePlan = {
	/** Each Project to move, by its id in `from`: its Space and its id there. */
	projects: Readonly<Record<string, ProjectTarget>>;
	/** A Person's id in `from`: their id in the Space the rows go to. */
	personMap?: Readonly<Record<string, string>>;
	/**
	 * The moved events of this computer take the numbers after its latest
	 * one, so they reach the Host of a Space it moves them into.
	 */
	renumber?: boolean;
	/**
	 * Only the runs this computer walks move: it takes its own copy of the
	 * Projects (a split), and `from` keeps the rest. Every Project keeps
	 * its id, and only this computer's Clones go along in the documents.
	 */
	ownRunsOnly?: boolean;
	/**
	 * Every Project of `from` moves. Nothing moves when one is left, also one
	 * that another process added after `plan`.
	 */
	empties?: boolean;
	/**
	 * Each schedule of a moved Project as it is to be after the move. It
	 * returns the schedule itself to keep it as it is.
	 */
	schedule?(schedule: Schedule): Schedule;
};

/** A move of Projects out of one Space. */
export type ProjectsMove = {
	from: string;
	/** Runs under the hold, before anything changes: throws to call the move off. */
	plan(): Promise<ProjectsMovePlan>;
	/** The caller's own rows of the move, for the same batch. */
	statements?(moved: MovedProjects): RowBatch | Promise<RowBatch>;
};

/** What a move moved. */
export type MovedProjects = {
	/** The Projects, by their id in `from`. */
	projects: string[];
	/** The runs that moved with them. */
	runIds: string[];
	/** How many schedules `plan.schedule` changed. */
	schedules: number;
};

/**
 * What a move moved, for the data of this Replica that follows its
 * Projects outside the rows: each Project's knowledge (its document, its
 * folder, its content in the archive and its search index).
 */
export type ProjectsMoved = {
	from: string;
	/** Each moved Project, by its id in `from`: its Space and its id there. */
	projects: Readonly<Record<string, ProjectTarget>>;
};

/** The runs a move takes from one Space to another, for the rows that move with them. */
export type MovedRuns = {
	from: string;
	to: string;
	runIds: readonly string[];
	/** A Person's id in `from`: their id in `to`. */
	personMap: Readonly<Record<string, string>>;
};

/**
 * The rows of Projects that move from one Space to another, as the
 * statements of one batch (`MoveStore.batchOf`).
 *
 * - `projectMap` names each Project to move, by its id in `from`, with
 *   its id in `to`: its own, or the id of the Project of `to` with the
 *   same remote. A Project that maps onto another one gives it its rows,
 *   and its own row goes.
 * - `personMap` gives a Person of `from` their id in `to`.
 * - `walkerId`: this computer. Its moved events take the numbers after
 *   its latest event that does not move, in their order.
 * - `runsOf`: only the runs this Walker walks move.
 */
export type RowMove = {
	from: string;
	to: string;
	/** Each Project to move, by its id in `from`: its id in `to`. */
	projectMap: Readonly<Record<string, string>>;
	/** A Person's id in `from`: their id in `to`. */
	personMap?: Readonly<Record<string, string>>;
	/** This computer: its moved events get new numbers after its latest. */
	walkerId?: string;
	/** Only the runs this Walker walks move. */
	runsOf?: string;
};

/** A Project's row as it was before a move: the documents take an entry from it. */
export type ProjectRow = {
	id: string;
	spaceId: string;
	name: string;
	remote: string | null;
	/** False: a project without a folder (ADR 22). */
	folder: boolean;
	createdAt: Date;
	removedAt: Date | null;
};

/** One Space the Projects of a move go to: their ids in `from` and in it. */
export type MoveGroup = { to: string; map: Record<string, string> };

/**
 * The Spaces the Projects go to, in the order the plan first names each,
 * with each Project's id in `from` and its id there.
 */
export function groupBySpace(
	projects: Readonly<Record<string, ProjectTarget>>,
): MoveGroup[] {
	const bySpace = new Map<string, Record<string, string>>();
	for (const [source, target] of Object.entries(projects)) {
		bySpace.set(target.spaceId, {
			...bySpace.get(target.spaceId),
			[source]: target.projectId,
		});
	}
	return [...bySpace].map(([to, map]) => ({ to, map }));
}

/** A person's move of a Project, refused while a run of it runs a step. */
export const STILL_RUNNING =
	"A run of this project is still running. Stop it to move the project.";
