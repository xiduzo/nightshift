import { type KnownRun, knownRun } from "../domain/run-files";
import { cleanupTime, lastChangeCleanupTime } from "../domain/safety";
import type {
	CleanupGround,
	CleanupRuns,
	RemovalLog,
	RunFolderFiles,
} from "./ports";

export type SweepRunFoldersPorts = {
	folders: Pick<RunFolderFiles, "runIds" | "lastChange" | "remove" | "path">;
	runs: Pick<CleanupRuns, "runRow" | "runState" | "flowUnread" | "isActive">;
	ground: CleanupGround;
	removalLog: Pick<RemovalLog, "removed">;
};

/** What the sweep did: the runs whose folders went, and how many stayed after an error. */
export type RunFilesSweep = { removed: string[]; kept: number };

/**
 * The scheduled cleanup of the run folders on this computer: each one
 * that is due goes, with its files. The folder of a run this computer
 * knows is due `cleanUpAfterDays` after the run ended, never while it is
 * open or only another version can continue it. The folder of a run it does not know is due `cleanUpAfterDays`
 * after its last change. Each removal of a run it knows is logged as
 * `WorktreeRemoved`. An error with one folder is logged and skipped.
 */
export const sweepRunFolders =
	(ports: SweepRunFoldersPorts) => async (): Promise<RunFilesSweep> => {
		const { folders } = ports;

		/** Whether the folder of `runId` is due: never while its run keeps it. */
		async function due(
			runId: string,
			run: KnownRun | null,
			afterDays: number,
			now: number,
		): Promise<boolean> {
			if (run) return !run.keeps && cleanupTime(run, afterDays) <= now;
			const changed = await folders.lastChange(runId);
			return (
				changed !== null && lastChangeCleanupTime(changed, afterDays) <= now
			);
		}

		const result: RunFilesSweep = { removed: [], kept: 0 };
		const { cleanUpRuns, cleanUpAfterDays } = ports.ground.settings();
		if (!cleanUpRuns) return result;
		const now = ports.ground.now();
		for (const runId of await folders.runIds()) {
			try {
				const run = await knownRun(runId, ports.runs);
				if (!(await due(runId, run, cleanUpAfterDays, now))) continue;
				await folders.remove(runId);
				result.removed.push(runId);
				if (run) {
					await ports.removalLog.removed({
						projectId: run.projectId,
						runId,
						worktreePath: folders.path(runId),
						branches: [],
						by: "cleanup",
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
	};
