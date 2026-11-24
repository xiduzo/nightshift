import type { Access } from "../../access";
import {
	type DrizzleRunViewsDeps,
	drizzleRunViews,
} from "./adapters/out/drizzle-run-views";
import { listProjectRuns } from "./application/list-project-runs";
import { listRuns } from "./application/list-runs";
import type { PrivatePaths, RunViews } from "./application/ports";
import { readRun } from "./application/read-run";
import { readStep } from "./application/read-step";
import { readStepTranscript } from "./application/read-step-transcript";
import { watchRun } from "./application/watch-run";

/**
 * The wiring of the views: the one place that builds their real adapter
 * (the runs over the database and the run log) and binds each read to
 * its ports.
 */

/** What the engine gives the views: what their real adapter stands on, and who may see a run. */
export type ViewsDeps = DrizzleRunViewsDeps & {
	/** Hides the worktree paths of runs on Devices the actor does not own (`Peers.pathsFor`). */
	pathsFor: PrivatePaths["for"];
	/** Who may see a run or a Space (`access`). */
	access: Pick<Access, "openRun" | "openSpace">;
};

/** A run's status and whether it is on this computer. */
export type RunHere = NonNullable<Awaited<ReturnType<RunViews["runHere"]>>>;

/** The reads of the runs, bound to their ports, and two calls of the views that Night Shift itself makes. */
export type Views = {
	/** The views themselves, for the readers in this process that act for Night Shift. */
	reads: RunViews;
	listRuns: ReturnType<typeof listRuns>;
	listProjectRuns: ReturnType<typeof listProjectRuns>;
	readRun: ReturnType<typeof readRun>;
	readStep: ReturnType<typeof readStep>;
	readStepTranscript: ReturnType<typeof readStepTranscript>;
	watchRun: ReturnType<typeof watchRun>;
	/**
	 * Where a run is and what it does, cheap, in any Space of this Replica,
	 * for Night Shift itself (keep this computer awake). Null for a run this
	 * Replica does not have.
	 */
	readRunHere: (request: { runId: string }) => ReturnType<RunViews["runHere"]>;
	/**
	 * A run as an export to monitoring reads it, in any Space of this
	 * Replica, for Night Shift itself. Null for a run this Replica has no
	 * events of.
	 */
	readRunTrace: (request: { runId: string }) => ReturnType<RunViews["trace"]>;
};

export function wireViews(deps: ViewsDeps): Views {
	const { pathsFor, access, ...stands } = deps;
	const views = drizzleRunViews(stands);
	const paths: PrivatePaths = { for: pathsFor };
	const { openRun, openSpace } = access;
	return {
		reads: views,
		listRuns: listRuns({ views, paths, openSpace }),
		listProjectRuns: listProjectRuns({ views, openSpace }),
		readRun: readRun({ views, paths, openRun }),
		readStep: readStep({ views, openRun }),
		readStepTranscript: readStepTranscript({ views, openRun }),
		watchRun: watchRun({ views, openRun }),
		readRunHere: ({ runId }) => views.runHere(runId),
		readRunTrace: ({ runId }) => views.trace(runId),
	};
}
