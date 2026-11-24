import type { LoggedEvent, SleepFact } from "../../../log";

/**
 * The driven ports of recovery: the work the last daemon left open, the
 * folders runs work in, and the sleeps of the runs this computer walks.
 * Each is recovery's own, with a real adapter, an in-memory adapter and a
 * contract suite in `adapters/out/`.
 */

/** The work the last daemon left open on this computer. */
export type OpenWork = {
	/** Prunes every run's thread to what a resume reads. Cheap once clean. */
	pruneCheckpoints(): Promise<void>;
	/**
	 * The lifecycle events of the runs this computer walks, by run, in seq
	 * order: the events that open or close work. A run that moved here and
	 * has not arrived is left out: its take-over gives it its walk state.
	 */
	walkedHere(): Promise<Map<string, LoggedEvent[]>>;
	/**
	 * Ends the run's open work as a stop ends it, from the run's whole log,
	 * and tells the run's watchers. `waits`: its open Gates and sleeps too.
	 */
	close(
		runId: string,
		cut: { kind: "interrupted"; reason: string; waits?: boolean },
	): Promise<void>;
	/** An interrupted run that does not continue lets go of what it holds (leases). */
	letGo(runId: string): Promise<void>;
};

/** The folders runs work in on this computer. */
export type Workplaces = {
	/** Whether a folder is at the path. A file is not a folder. */
	there(path: string): Promise<boolean>;
};

/** The sleeps of the runs this computer walks. */
export type Waits = {
	/** The sleep of each run this computer walks, by run. Null: it does not sleep. */
	sleeping(): Promise<Map<string, SleepFact | null>>;
	/**
	 * The runs of the project this computer walks that ever waited for a
	 * signal of that name. Most have moved on: the log of each says.
	 */
	waitedFor(projectId: string, signal: string): Promise<string[]>;
};
