import type { RunState } from "./run-state";

/*
 * A copy of a step's file says which end of the step it holds: its
 * stamp. A step opens when it starts, and again at each reopen
 * (`StepReopened`) or second start (`run-state.ts`). The stamp is the number of that opening and whether
 * it had ended when the copy was taken. The Run Log gives both, the same
 * on every Replica that has the run's events: a run that moves keeps its
 * stamps, and `seq` (the order on one Replica) plays no part.
 *
 * A reader keeps or serves a copy only when its stamp holds the step as
 * the reader's own log says (`stampHolds`). A copy of an earlier end, or
 * one taken while the step ran, is not there yet: the reader reads the
 * step again once the right copy lands.
 */

/** Which end of its step a copy of a step's file holds. */
export type CopyStamp = {
	/** The step's opening: 1 for its start, one more for each reopen. */
	opening: number;
	/** That opening had ended. */
	ended: boolean;
};

/**
 * The stamp a copy of each step's file taken now carries, by step id: the
 * number of its latest opening and whether that opening ended. A step the
 * run did not start has none. The run log keeps it per run until the next
 * append (`RunLog.derive`), so every reader of a stamp shares it.
 */
export function copyStamps(run: RunState): ReadonlyMap<string, CopyStamp> {
	const stamps = new Map<string, CopyStamp>();
	for (const [stepId, step] of run.steps) {
		stamps.set(stepId, {
			opening: step.openings.length,
			ended: step.openings.at(-1)?.end != null,
		});
	}
	return stamps;
}

/**
 * Whether a copy with `stamp` holds the step as a reader knows it
 * (`known`, from the reader's log): the same opening, ended when the
 * reader knows it ended. A copy without a stamp comes from a peer of an
 * older version: it holds, as every copy did before stamps.
 */
export function stampHolds(
	stamp: CopyStamp | undefined,
	known: CopyStamp | null,
): boolean {
	if (stamp === undefined) return true;
	if (known === null) return false;
	return stamp.opening === known.opening && (stamp.ended || !known.ended);
}
