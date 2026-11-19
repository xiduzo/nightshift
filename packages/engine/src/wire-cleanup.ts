import type { Database } from "@nightshift/db";
import {
	createRunCopies,
	createRunFiles,
	type RunFilesService,
	startCleanupJob,
} from "./cleanup";
import type { EngineInternals } from "./engine";
import { createRunBranches, type Git } from "./git";
import type { Runner } from "./graph";
import { getRunRow, type RunLog } from "./log";
import type { Views } from "./runs";

type RunCopiesDeps = Parameters<typeof createRunCopies>[0];
type RunFilesDeps = Parameters<typeof createRunFiles>[0];

/**
 * The cleanup block of the engine's composition (`wire.ts`): what ended
 * runs left on this computer (`cleanup/`). The worktrees and branches of
 * runs, the files of run folders, and the scheduled sweep of both. Phase
 * 3 of the hexagon series makes it a slice.
 *
 * It gives `runFiles`: the Space view lists and reads the files of a run
 * folder.
 */
export function wireEngineCleanup(deps: {
	db: Database;
	log: RunLog;
	git: Git;
	projects: RunCopiesDeps["projects"];
	views: { reads: Pick<Views["reads"], "listRuns" | "runStatus"> };
	runner: Pick<Runner, "isActive">;
	folders: RunFilesDeps["folders"];
	now(): number;
	settings: RunCopiesDeps["settings"];
	ready: Promise<unknown>;
	signal: AbortSignal;
	internals: Pick<
		EngineInternals,
		"cleanupDelayMs" | "cleanupEveryMs" | "cleanupSwept"
	>;
}): { runFiles: RunFilesService } {
	const { db, log, views, runner, now, settings, internals } = deps;
	/** The scheduled cleanup of the worktrees and branches runs left on this computer. */
	const runCopies = createRunCopies({
		log,
		branches: createRunBranches(deps.git),
		projects: deps.projects,
		listRuns: views.reads.listRuns,
		runStatus: views.reads.runStatus,
		isActive: (runId) => runner.isActive(runId),
		now,
		settings,
	});
	/** The files of run folders on this computer, and the scheduled cleanup of the folders. */
	const runFiles = createRunFiles({
		db,
		log,
		folders: deps.folders,
		runRow: (runId) => getRunRow(db, runId),
		runState: (runId) => log.state(runId),
		isActive: (runId) => runner.isActive(runId),
		now,
		settings,
	});
	startCleanupJob({
		sweeps: { "run copies": runCopies.sweep, "run folders": runFiles.sweep },
		ready: deps.ready,
		signal: deps.signal,
		...(internals.cleanupDelayMs !== undefined
			? { delayMs: internals.cleanupDelayMs }
			: {}),
		...(internals.cleanupEveryMs !== undefined
			? { everyMs: internals.cleanupEveryMs }
			: {}),
		...(internals.cleanupSwept ? { swept: internals.cleanupSwept } : {}),
	});
	return { runFiles };
}
