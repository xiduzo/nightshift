import type { Database } from "@nightshift/db";
import type { Access } from "./access";
import type { EngineInternals } from "./engine";
import type { Git } from "./git";
import type { Runner } from "./graph";
import { getRunRow, type RunLog } from "./log";
import type { Projects } from "./projects";
import type { RunFolders } from "./run-folders";
import type { Views } from "./runs";
import { type Cleanup, wireCleanup } from "./runs";

/**
 * The cleanup block of the engine's composition (`wire.ts`): what ended
 * runs left on this computer (`cleanup/`, a slice with rings). It fills
 * the ports of the cleanup from the engine's pieces: the runs from the
 * views, the log and the runner, the projects, the clock and the
 * settings. `wireCleanup` starts the scheduled sweep of the worktrees,
 * branches and run folders.
 *
 * It gives `runFiles`: the Space view lists and reads the files of a run
 * folder.
 */
export function wireEngineCleanup(deps: {
	db: Database;
	log: RunLog;
	git: Git;
	access: Pick<Access, "openRun">;
	projects: Pick<Projects, "list">;
	views: { reads: Pick<Views["reads"], "listRuns" | "runStatus"> };
	runner: Pick<Runner, "isActive">;
	folders: RunFolders;
	now(): number;
	settings(): { cleanUpRuns: boolean; cleanUpAfterDays: number };
	ready: Promise<unknown>;
	signal: AbortSignal;
	internals: Pick<
		EngineInternals,
		"cleanupDelayMs" | "cleanupEveryMs" | "cleanupSwept"
	>;
}): { runFiles: Pick<Cleanup, "listRunFiles" | "readRunFile"> } {
	const { db, log, views, runner, internals } = deps;
	const runFiles = wireCleanup({
		access: deps.access,
		runs: {
			listRuns: views.reads.listRuns,
			runStatus: views.reads.runStatus,
			runRow: (runId) => getRunRow(db, runId),
			runState: (runId) => log.state(runId),
			isActive: (runId) => runner.isActive(runId),
		},
		projects: deps.projects,
		ground: { now: deps.now, settings: deps.settings },
		db,
		log,
		git: deps.git,
		folders: deps.folders,
		timer: {
			ready: deps.ready,
			signal: deps.signal,
			...(internals.cleanupDelayMs !== undefined
				? { delayMs: internals.cleanupDelayMs }
				: {}),
			...(internals.cleanupEveryMs !== undefined
				? { everyMs: internals.cleanupEveryMs }
				: {}),
			...(internals.cleanupSwept ? { swept: internals.cleanupSwept } : {}),
		},
	});
	return { runFiles };
}
