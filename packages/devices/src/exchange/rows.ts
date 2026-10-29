import type { RunRows, SyncCursors } from "../contract";

export { ForeignRowsError, MissingProjectError } from "@nightshift/engine";

/**
 * Batches of run history as the exchange carries them: what both halves
 * do to a batch beside the ingest (`run-history.ts`). The wire schemas of
 * a batch and of the cursors are in `contract/`.
 */

/** A batch with no rows. */
export const NO_ROWS: RunRows = {
	runs: [],
	steps: [],
	sessions: [],
	events: [],
};

/** Moves `into` forward by `by`, per Space and Walker. */
export function mergeCursors(into: SyncCursors, by: SyncCursors): SyncCursors {
	const merged: SyncCursors = { ...into };
	for (const [spaceId, walkers] of Object.entries(by)) {
		const current = { ...merged[spaceId] };
		for (const [walkerId, seq] of Object.entries(walkers)) {
			current[walkerId] = Math.max(current[walkerId] ?? 0, seq);
		}
		merged[spaceId] = current;
	}
	return merged;
}

/** Whether a batch has no rows. */
export function isEmpty(rows: RunRows): boolean {
	return rows.events.length === 0;
}
