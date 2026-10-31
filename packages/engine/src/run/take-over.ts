import type { Database } from "@nightshift/db";
import type { Runner, RunWalks } from "../graph";
import {
	parseTranscript,
	type RunLog,
	runsArriving,
	stepIdsOfRun,
} from "../log";
import type { RunsPort } from "./peers";

/**
 * This computer walks a run another Device moved here (`WalkerMoved`, the
 * other half of a move in `actions.ts`): its Checkpoint comes from the
 * archive (this Replica's, else the Host's) into the checkpoint tables, its
 * transcript continues after the entries the archive keeps, and a sleeping
 * run gets its wake timer. A run at a Gate waits for its answer here; a
 * stopped one for a resume.
 *
 * It ends with `WalkerArrived`, in a Turn of the runner, so no answer,
 * wake or resume comes in between. Until that is in the log the run still
 * arrives: a take-over that fails, or that a restart cuts short, is done
 * again, and every step of it repeats safely. One of a run that already
 * arrived does nothing.
 */
export async function takeOver(
	deps: {
		db: Database;
		log: Pick<RunLog, "events" | "state" | "append" | "walkerId">;
		runner: Pick<
			Runner,
			"hold" | "forget" | "restore" | "continueTranscriptAfter"
		>;
		archive: Pick<RunsPort, "archived">;
		walks: Pick<RunWalks, "importWalk" | "importTranscript">;
	},
	runId: string,
): Promise<void> {
	// The one Turn a run that still arrives takes (`arrival`).
	await deps.runner.hold(
		runId,
		async ({ row }) => {
			const self = await deps.log.walkerId();
			const events = await deps.log.events(runId);
			const moved = events.findLast((e) => e.type === "WalkerMoved");
			if (
				moved?.type !== "WalkerMoved" ||
				!(await runsArriving(deps.db, [self], [runId])).includes(runId)
			) {
				return;
			}
			const checkpoint = await deps.archive.archived({
				kind: "checkpoint",
				spaceId: row.spaceId,
				runId,
			});
			if (checkpoint === null) {
				throw new Error("The archive has no checkpoint of the run.");
			}
			await deps.walks.importWalk(runId, checkpoint);
			// The old Walker's transcript files are on its disk, not here: each
			// step's file starts as the archive's copy (a step reopened or
			// answered here goes on in it), and the next entry is numbered after
			// the last one the old Walker archived.
			let lastSeq = 0;
			for (const stepId of await stepIdsOfRun(deps.db, runId)) {
				const text = await deps.archive.archived({
					kind: "transcript",
					spaceId: row.spaceId,
					runId,
					stepId,
				});
				if (text === null) continue;
				await deps.walks.importTranscript(runId, stepId, text);
				for (const entry of parseTranscript(text)) {
					lastSeq = Math.max(lastSeq, entry.seq);
				}
			}
			await deps.log.append({
				type: "WalkerArrived",
				runId,
				payload: { from: moved.payload.from },
			});
			deps.runner.continueTranscriptAfter(runId, lastSeq);
			deps.runner.forget(runId);
			deps.runner.restore(runId, await deps.log.state(runId));
		},
		{ arrival: true },
	);
}
