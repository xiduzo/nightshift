import type { RunEnding, RunRow, RunState, Scope } from "../log";

/**
 * What a run holds for a scope: a lease (ADR 7), and later a service
 * (ADR 9). The scope is the run, or a named Section. The engine lets go
 * of what a run holds on every end of the run, whatever ends it, so a
 * flow never has to clean up after itself. Each kind that a run can hold
 * implements this port (`leases/holds.ts`), and `combineHolds` puts them
 * together for the runner, `closeOpenWork` and startup recovery. What a
 * run holds is in its log (`RunState.holds`). A run that leaves a Section
 * lets go of its holds there as it routes on (`route.ts`).
 */
export type RunHolds = {
	/**
	 * The run ended (`RunEnded`), as `status` says: done, failed, stopped,
	 * a step that failed. An `interrupted` run keeps what it holds: the
	 * daemon died, and startup recovery continues the run, or tells
	 * `notContinuing`.
	 */
	ended(runId: string, status: RunEnding): Promise<void>;
	/** A run that the daemon interrupted does not continue on its own. */
	notContinuing(runId: string): Promise<void>;
	/**
	 * The run is about to resume at `at`: it takes again what it held when
	 * it ended and what `at` is inside of (`RunState.endedHolding`), before
	 * its next step. Throws a `Refusal` when it cannot: another run holds a
	 * lease now. Then the run does not resume.
	 */
	resuming(
		row: RunRow,
		run: RunState,
		at: { nodeId: string; scope: Scope | null },
	): Promise<void>;
};

/** A run that holds nothing. */
export const NO_HOLDS: RunHolds = {
	ended: async () => {},
	notContinuing: async () => {},
	resuming: async () => {},
};

/**
 * Several kinds of holds as one. Each part runs, also when another throws:
 * a lease that cannot be released must not keep a service running. The
 * first error is thrown once all ran.
 */
export function combineHolds(parts: readonly RunHolds[]): RunHolds {
	const each = async (call: (part: RunHolds) => Promise<void>) => {
		const results = await Promise.allSettled(parts.map(call));
		const failed = results.find((result) => result.status === "rejected");
		if (failed) throw (failed as PromiseRejectedResult).reason;
	};
	return {
		ended: (runId, status) => each((part) => part.ended(runId, status)),
		notContinuing: (runId) => each((part) => part.notContinuing(runId)),
		// In order, each after the last: a run that cannot take its lease
		// back does not start its service either.
		async resuming(row, run, at) {
			for (const part of parts) await part.resuming(row, run, at);
		},
	};
}

/**
 * Tells `holds` that the run ended, and logs a failure instead of
 * throwing: the run's end is written, and a lease that is not released
 * expires after its ttl.
 */
export async function letGo(
	holds: RunHolds,
	runId: string,
	status: RunEnding,
): Promise<void> {
	try {
		await holds.ended(runId, status);
	} catch (error) {
		console.warn(`[engine] could not let go of what run ${runId} holds`, error);
	}
}
