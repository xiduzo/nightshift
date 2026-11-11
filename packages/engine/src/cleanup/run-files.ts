import type { Database } from "@nightshift/db";
import { Refusal } from "@nightshift/refusal";
import { instant } from "@nightshift/time";
import {
	type RunLog,
	type RunRow,
	type RunState,
	worktreeRemovals,
} from "../log";
import { isOpenStatus } from "../read";
import type { RunFile, RunFolders } from "../run-folders";
import { cleanupTime, lastChangeCleanupTime } from "./safety";

/**
 * The files a run of a project without a folder left in its run folder on
 * this computer (ADR 22), and their removal: the list the run page shows,
 * one file of it, and the scheduled sweep. There is no git, so nothing
 * tells what is safe to keep: the sweep removes the folder of a run that
 * ended `cleanUpAfterDays` ago, whatever is in it. It never touches a run
 * that is still open. A folder of a run this computer does not know (the
 * folder of a step it ran for another Person's run) goes `cleanUpAfterDays`
 * after its last change. Each Device sweeps its own folders. Each removal
 * of a run this computer knows is logged as `WorktreeRemoved`.
 */

/** The files of a run in its run folder on this computer. */
export type RunFiles = {
	/** The run works in a run folder, and its folder is on this computer. */
	here: boolean;
	/** By path. Empty for a run that works in a copy of the project. */
	files: RunFile[];
	/** The folder holds more entries than the list shows. */
	more: boolean;
	/** When the scheduled cleanup removes the folder. Null when it never will on its own: the run goes on, or the cleanup is off. */
	cleanupAt: number | null;
	/** When this computer removed the folder, and who. Null while it is here. */
	removed: { at: number; by: "person" | "cleanup" } | null;
};

/** What the sweep did: the runs whose folders went, and how many stayed after an error. */
export type RunFilesSweep = { removed: string[]; kept: number };

export type RunFilesDeps = {
	db: Database;
	/** Appends `WorktreeRemoved`. */
	log: Pick<RunLog, "append">;
	folders: RunFolders;
	/** The run's row. Refuses (`not-found`) a run this computer does not know. */
	runRow(runId: string): Promise<RunRow>;
	runState(
		runId: string,
	): Promise<Pick<RunState, "status" | "end" | "runFolder">>;
	/** A step of the run is at work in this process. */
	isActive(runId: string): boolean;
	now(): number;
	settings(): { cleanUpRuns: boolean; cleanUpAfterDays: number };
};

/** A run this computer knows: what the cleanup reads of it. */
type KnownRun = {
	id: string;
	projectId: string;
	createdAt: number;
	endedAt: number | null;
	/** Running, waiting or sleeping: nothing removes its folder. */
	open: boolean;
	runFolder: boolean;
};

const NO_FILES = {
	here: false,
	files: [],
	more: false,
	cleanupAt: null,
	removed: null,
};

export function createRunFiles(deps: RunFilesDeps) {
	const { folders } = deps;

	/** The run as this computer knows it, or null when it knows none of that id. */
	async function knownRun(runId: string): Promise<KnownRun | null> {
		let row: RunRow;
		try {
			row = await deps.runRow(runId);
		} catch (error) {
			if (error instanceof Refusal && error.kind === "not-found") return null;
			throw error;
		}
		const state = await deps.runState(runId);
		return {
			id: runId,
			projectId: row.projectId,
			createdAt: instant(row.createdAt),
			endedAt: state.end?.at ?? null,
			open: isOpenStatus(state.status) || deps.isActive(runId),
			runFolder: state.runFolder,
		};
	}

	/** The latest removal of the run's folder on this computer. */
	async function lastRemoval(run: KnownRun): Promise<RunFiles["removed"]> {
		const removals = await worktreeRemovals(deps.db, run.projectId);
		const last = removals.findLast((e) => e.payload.runId === run.id);
		return last ? { at: last.at, by: last.payload.by } : null;
	}

	/** The files of the run in its folder on this computer. The caller checked the run's Space. */
	async function list(runId: string): Promise<RunFiles> {
		const run = await knownRun(runId);
		if (!run?.runFolder) return NO_FILES;
		const listed = await folders.list(runId);
		if (!listed) return { ...NO_FILES, removed: await lastRemoval(run) };
		const { cleanUpRuns, cleanUpAfterDays } = deps.settings();
		return {
			here: true,
			files: listed.files,
			more: listed.more,
			cleanupAt:
				cleanUpRuns && !run.open ? cleanupTime(run, cleanUpAfterDays) : null,
			removed: null,
		};
	}

	/**
	 * One file of the run's folder on this computer, and where it is. Null
	 * when there is none at that path. The caller checked the run's Space.
	 */
	function file(
		runId: string,
		path: string,
	): Promise<{ file: RunFile; path: string } | null> {
		return folders.file(runId, path);
	}

	/** Whether the folder of `runId` is due: never while its run is open. */
	async function due(
		runId: string,
		run: KnownRun | null,
		afterDays: number,
		now: number,
	): Promise<boolean> {
		if (run) return !run.open && cleanupTime(run, afterDays) <= now;
		const changed = await folders.lastChange(runId);
		return changed !== null && lastChangeCleanupTime(changed, afterDays) <= now;
	}

	/**
	 * The scheduled cleanup of the run folders on this computer: each one
	 * that is due goes, with its files. An error with one folder is logged
	 * and skipped.
	 */
	async function sweep(): Promise<RunFilesSweep> {
		const result: RunFilesSweep = { removed: [], kept: 0 };
		const { cleanUpRuns, cleanUpAfterDays } = deps.settings();
		if (!cleanUpRuns) return result;
		const now = deps.now();
		for (const runId of await folders.runIds()) {
			try {
				const run = await knownRun(runId);
				if (!(await due(runId, run, cleanUpAfterDays, now))) continue;
				await folders.remove(runId);
				result.removed.push(runId);
				if (run) {
					await deps.log.append({
						type: "WorktreeRemoved",
						payload: {
							projectId: run.projectId,
							runId,
							worktreePath: folders.path(runId),
							branches: [],
							by: "cleanup",
						},
					});
				}
			} catch (error) {
				result.kept++;
				console.warn(
					`[cleanup] kept the folder of run ${runId}:`,
					error instanceof Error ? error.message : error,
				);
			}
		}
		return result;
	}

	return { list, file, sweep };
}

export type RunFilesService = ReturnType<typeof createRunFiles>;
