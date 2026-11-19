import type { Database } from "@nightshift/db";
import type { RunWalks } from "../../../../graph";
import {
	applyWalkerMoves,
	parseTranscript,
	runsArriving,
	stepIdsOfRun,
} from "../../../../log";
import type { RunsPort } from "../../../../peers";
import type { WalkHandover } from "../../application/ports";

export type ArchiveWalkHandoverDeps = {
	db: Database;
	/** This computer's id as the Walker of its runs. */
	walkerId(): Promise<string>;
	/** The archive of the Replica that keeps the run's Space: this one, or its Host (`RunsPort`). */
	archive: Pick<RunsPort, "keepWalk" | "archived">;
	/** The walk state of this computer's runs as files (`graph/checkpoints/walk-state.ts`). */
	walks: Pick<RunWalks, "exportWalk" | "importWalk" | "importTranscript">;
};

/**
 * The hand-over of a run's walk state over the Space archive of the peers
 * and this computer's walk files: the Checkpoint tables, the steps'
 * transcripts in the data folder, and the run rows of the run log.
 */
export function archiveWalkHandover(
	deps: ArchiveWalkHandoverDeps,
): WalkHandover {
	const { db, archive, walks } = deps;
	return {
		async keep(runId) {
			await archive.keepWalk(await walks.exportWalk(runId));
		},
		moved: (event) => applyWalkerMoves(db, [event]),
		async arriving(runId) {
			const self = await deps.walkerId();
			return (await runsArriving(db, [self], [runId])).includes(runId);
		},
		async takeCheckpoint(run) {
			const checkpoint = await archive.archived({
				kind: "checkpoint",
				spaceId: run.spaceId,
				runId: run.id,
			});
			if (checkpoint === null) return false;
			await walks.importWalk(run.id, checkpoint);
			return true;
		},
		async takeTranscripts(run) {
			let lastSeq = 0;
			for (const stepId of await stepIdsOfRun(db, run.id)) {
				const text = await archive.archived({
					kind: "transcript",
					spaceId: run.spaceId,
					runId: run.id,
					stepId,
				});
				if (text === null) continue;
				await walks.importTranscript(run.id, stepId, text);
				for (const entry of parseTranscript(text)) {
					lastSeq = Math.max(lastSeq, entry.seq);
				}
			}
			return lastSeq;
		},
	};
}
