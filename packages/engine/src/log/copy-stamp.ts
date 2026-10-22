import type { LoggedEvent } from "./events";

/*
 * A copy of a step's file says which end of the step it holds: its
 * stamp. A step opens when it starts, and again at each reopen
 * (`StepReopened`). The stamp is the number of that opening and whether
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
 * The stamp a copy of a step's file taken now carries, from the run's
 * events. Null for a step the events do not start.
 */
export function copyStampOf(
	events: readonly LoggedEvent[],
	stepId: string,
): CopyStamp | null {
	let opening = 0;
	let ended = false;
	for (const e of [...events].sort((x, y) => x.seq - y.seq)) {
		if (e.stepId !== stepId) continue;
		// As the read model does: a second start begins the step again.
		if (e.type === "StepStarted") {
			opening = 1;
			ended = false;
		} else if (e.type === "StepReopened" && opening > 0) {
			opening++;
			ended = false;
		} else if (e.type === "StepEnded" && opening > 0) ended = true;
	}
	return opening === 0 ? null : { opening, ended };
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
