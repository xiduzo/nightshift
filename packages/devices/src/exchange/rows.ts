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

/**
 * The rows without the Walker's own paths: where its worktree, transcripts
 * and command logs are on its disk. They are private to the Walker's
 * owner, so a Replica of another Person never gets them. Rows keep their
 * shape: a path becomes "" (`run.worktree_path`, `step.transcript_path`,
 * `WorktreeCreated.worktreePath`, `HandedOff.worktreePath`,
 * `StepStarted.transcriptPath`), and a
 * `StepStarted.logPath` that was set becomes "" too, so it still says the
 * step has a log. `keep` says per Walker whose paths stay.
 */
export function withoutPrivatePaths(
	rows: RunRows,
	keep: (walkerId: string) => boolean = () => false,
): RunRows {
	const walkerOf = new Map(rows.runs.map((r) => [r.id, r.walkerId]));
	const strip = (walkerId: string | undefined) =>
		walkerId === undefined || !keep(walkerId);
	return {
		runs: rows.runs.map((r) =>
			strip(r.walkerId) ? { ...r, worktreePath: "" } : r,
		),
		steps: rows.steps.map((s) =>
			strip(walkerOf.get(s.runId)) ? { ...s, transcriptPath: "" } : s,
		),
		sessions: rows.sessions,
		events: rows.events.map((e) => {
			if (!strip(e.walkerId)) return e;
			if (
				e.type !== "WorktreeCreated" &&
				e.type !== "StepStarted" &&
				e.type !== "HandedOff"
			) {
				return e;
			}
			const payload = JSON.parse(e.payload) as Record<string, unknown>;
			if (e.type === "WorktreeCreated" || e.type === "HandedOff") {
				payload.worktreePath = "";
			} else {
				payload.transcriptPath = "";
				if (typeof payload.logPath === "string") payload.logPath = "";
			}
			return { ...e, payload: JSON.stringify(payload) };
		}),
	};
}

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
