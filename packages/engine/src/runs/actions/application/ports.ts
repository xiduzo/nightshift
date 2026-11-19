/**
 * The driven port of the actions that is their own: the leases a run lets
 * go of. It has a real adapter, an in-memory adapter and a contract suite
 * in `adapters/out/`. The ports every action shares (the run's facts, its
 * Turns, its Walker) are those of `runs/walk`.
 */

/** The leases of the runs this computer walks (ADR 7), wherever their Space keeps them. */
export type RunLeases = {
	/** Lets go of the run's leases of these names. A lease it does not hold stays as it is. */
	release(runId: string, names: readonly string[]): Promise<void>;
};
