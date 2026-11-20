import type { Schedule } from "@nightshift/flows";
import { Refusal } from "@nightshift/refusal";
import type { RowBatch } from "../../../contract";
import type {
	MovedSchedules,
	MoveHolds,
	MoveLog,
	MoveRows,
	ProjectLookup,
	ProjectRuns,
	ProjectsMovedHook,
	Reread,
	ThisWalker,
} from "../../application/ports";
import type { MovedRuns, ProjectsMoved } from "../../domain/move";
import { inMemoryMoveStore, moveRecords } from "./in-memory-move-store";
import { entryRecords, inMemorySpaceEntries } from "./in-memory-space-entries";

/**
 * The in-memory adapters of the ports other verticals fill, and
 * `inMemorySpaceMovePorts`, which gives a use-case test every port of the
 * slice at once. Every call lands in one list, `steps`, in its order, so
 * a test reads the order of a move. Test code: production code never
 * imports this file.
 */

/** The holds of a move: each call and each release is a step. */
export function inMemoryMoveHolds(steps: string[]): MoveHolds {
	return {
		async holdStarts(spaceId) {
			steps.push(`hold starts ${spaceId}`);
			return () => steps.push(`release starts ${spaceId}`);
		},
		async holdSchedules() {
			steps.push("hold schedules");
			return () => steps.push("release schedules");
		},
	};
}

export function inMemoryThisWalker(
	steps: string[],
	id = "this-computer",
): ThisWalker {
	return {
		async walkerId() {
			steps.push("walker");
			return id;
		},
	};
}

/** The schedules of each Project. A Project without a list is removed (`not-found`). */
export function inMemoryMovedSchedules(steps: string[]) {
	const lists = new Map<string, Schedule[]>();
	const port: MovedSchedules = {
		async schedules(projectId) {
			steps.push(`schedules ${projectId}`);
			const list = lists.get(projectId);
			if (!list) throw new Refusal("not-found", "That project does not exist.");
			return { schedules: list };
		},
		async saveSchedules(projectId, schedules) {
			steps.push(`save schedules ${projectId}`);
			lists.set(projectId, [...schedules]);
			return [];
		},
	};
	return { ...port, lists };
}

/** The rows of a package above the engine: a batch of one marker per call. */
export function inMemoryMoveRows(
	steps: string[],
	name: string,
): MoveRows & { asked: MovedRuns[] } {
	const asked: MovedRuns[] = [];
	const rows: MoveRows = async (runs) => {
		asked.push(runs);
		steps.push(`rows ${name} ${runs.to}`);
		return [`${name} ${runs.to}`] as unknown as RowBatch;
	};
	return Object.assign(rows, { asked });
}

export function inMemoryReread(steps: string[]): Reread {
	return {
		reread(runIds) {
			steps.push(`reread ${[...runIds].join(",")}`);
		},
	};
}

/** What follows the moved Projects. `fail` makes the next call throw. */
export function inMemoryProjectsMovedHook(steps: string[]) {
	const followed: ProjectsMoved[] = [];
	let fail = false;
	const hook: ProjectsMovedHook = {
		async moved(move) {
			steps.push(`moved ${move.from}`);
			followed.push(move);
			if (fail) {
				fail = false;
				throw new Error("The knowledge did not move.");
			}
		},
	};
	return {
		...hook,
		followed,
		failNext() {
			fail = true;
		},
	};
}

/** The Projects of each Space, by id. A move to a Space it lacks is refused. */
export function inMemoryProjectLookup(steps: string[]) {
	const projects = new Map<string, string>();
	const spaces = new Set<string>();
	const lookup: ProjectLookup = {
		async find(projectId, spaceId) {
			steps.push(`find ${projectId}`);
			if (projects.get(projectId) !== spaceId) {
				throw new Refusal("not-found", "That project does not exist.");
			}
			return { id: projectId };
		},
		async refuseMove(projectId, _from, to) {
			steps.push(`refuse move ${projectId}`);
			if (!spaces.has(to)) {
				throw new Refusal("not-found", "That Space does not exist.");
			}
		},
	};
	return { ...lookup, projects, spaces };
}

/** The runs of each Project, and the runs that run a step now. */
export function inMemoryProjectRuns(steps: string[]) {
	const runs = new Map<string, string[]>();
	const active = new Set<string>();
	const port: ProjectRuns = {
		async runIds(projectId) {
			steps.push(`runs of ${projectId}`);
			return runs.get(projectId) ?? [];
		},
		isActive: (runId) => active.has(runId),
	};
	return { ...port, runs, active };
}

export function inMemoryMoveLog(steps: string[]): MoveLog {
	return {
		async projectMoved(move) {
			steps.push(`log moved ${move.projectId} ${move.from} ${move.to}`);
		},
	};
}

/** Every port of the Space move in memory at once: where each use-case test starts. */
export function inMemorySpaceMovePorts() {
	const steps: string[] = [];
	const rows = moveRecords();
	const entries = entryRecords();
	const store = inMemoryMoveStore(rows);
	const spaceEntries = inMemorySpaceEntries(entries);
	const commands = inMemoryMoveRows(steps, "commands");
	return {
		steps,
		rows,
		entries,
		holds: inMemoryMoveHolds(steps),
		walker: inMemoryThisWalker(steps),
		moveStore: {
			...store,
			async runIds(...args: Parameters<typeof store.runIds>) {
				steps.push(`run ids ${args[0]} ${args[1].join(",")}`);
				return store.runIds(...args);
			},
			async projectRows(ids: readonly string[]) {
				steps.push("project rows");
				return store.projectRows(ids);
			},
			async batchOf(move: Parameters<typeof store.batchOf>[0]) {
				steps.push(`batch ${move.to}`);
				return store.batchOf(move);
			},
			async commit(batches: Parameters<typeof store.commit>[0]) {
				steps.push("commit");
				return store.commit(batches);
			},
		},
		movedSchedules: inMemoryMovedSchedules(steps),
		spaceEntries: {
			...spaceEntries,
			async move(move: Parameters<typeof spaceEntries.move>[0]) {
				steps.push("documents");
				return spaceEntries.move(move);
			},
		},
		commands,
		moveRows: [commands] as MoveRows[],
		reread: inMemoryReread(steps),
		projectsMoved: inMemoryProjectsMovedHook(steps),
		projectLookup: inMemoryProjectLookup(steps),
		projectRuns: inMemoryProjectRuns(steps),
		moveLog: inMemoryMoveLog(steps),
	};
}
