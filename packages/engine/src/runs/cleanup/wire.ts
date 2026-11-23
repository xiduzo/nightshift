import type { Database } from "@nightshift/db";
import { createRunBranches, type Git, keptRefsOf } from "../../git";
import type { RunLog } from "../../log";
import type { RunFolders } from "../../run-folders";
import { startCleanupJob } from "./adapters/in/cleanup-timer";
import { drizzleRemovalLog } from "./adapters/out/drizzle-removal-log";
import { listRunFiles } from "./application/list-run-files";
import type {
	CleanupAccess,
	CleanupGround,
	CleanupProjects,
	CleanupRuns,
} from "./application/ports";
import { readRunFile } from "./application/read-run-file";
import { sweepRunCopies } from "./application/sweep-run-copies";
import { sweepRunFolders } from "./application/sweep-run-folders";

/**
 * The wiring of cleanup: the one place that builds its real adapters
 * and binds each use case to its ports. It starts the timer of the
 * scheduled cleanup, as the engine is built.
 */

/** What the package gives cleanup: the ports another slice fills, and what the real adapters stand on. */
export type CleanupDeps = {
	/** Who may see a run (`openRun` of the engine's `runs`). */
	access: CleanupAccess;
	runs: CleanupRuns;
	projects: CleanupProjects;
	ground: CleanupGround;
	db: Database;
	/** Appends `WorktreeRemoved`. */
	log: Pick<RunLog, "append">;
	git: Git;
	folders: RunFolders;
	/** The timer of the scheduled cleanup: it starts when `ready` settles and stops with `signal`. */
	timer: {
		ready: Promise<unknown>;
		signal: AbortSignal;
		delayMs?: number;
		everyMs?: number;
		swept?: () => void;
	};
};

/** The use cases of cleanup, bound to their ports. */
export type Cleanup = {
	/** Removes the copies and branches of runs that ended a day ago, after it keeps the work that is only here. */
	sweepRunCopies: ReturnType<typeof sweepRunCopies>;
	/** Removes the run folders on this computer that are due, with their files. */
	sweepRunFolders: ReturnType<typeof sweepRunFolders>;
	/** Lists the files of a run's folder on this computer, and when the cleanup removes them. */
	listRunFiles: ReturnType<typeof listRunFiles>;
	/** Gives one file of a run's folder on this computer, and where it is. */
	readRunFile: ReturnType<typeof readRunFile>;
};

export function wireCleanup(deps: CleanupDeps): Cleanup {
	const ports = {
		access: deps.access,
		runs: deps.runs,
		projects: deps.projects,
		ground: deps.ground,
		branches: { ...createRunBranches(deps.git), keptRefs: keptRefsOf },
		folders: deps.folders,
		removalLog: drizzleRemovalLog({ db: deps.db, log: deps.log }),
	};
	const cleanup: Cleanup = {
		sweepRunCopies: sweepRunCopies(ports),
		sweepRunFolders: sweepRunFolders(ports),
		listRunFiles: listRunFiles(ports),
		readRunFile: readRunFile(ports),
	};
	const { timer } = deps;
	startCleanupJob({
		sweeps: {
			"run copies": cleanup.sweepRunCopies,
			"run folders": cleanup.sweepRunFolders,
		},
		ready: timer.ready,
		signal: timer.signal,
		...(timer.delayMs !== undefined ? { delayMs: timer.delayMs } : {}),
		...(timer.everyMs !== undefined ? { everyMs: timer.everyMs } : {}),
		...(timer.swept ? { swept: timer.swept } : {}),
	});
	return cleanup;
}
