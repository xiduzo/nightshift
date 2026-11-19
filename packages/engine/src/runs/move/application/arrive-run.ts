import type { RunFacts, Turns } from "../../walk";
import { NO_CHECKPOINT } from "../domain/move-rules";
import type { WalkHandover } from "./ports";

export type ArriveRunPorts = {
	facts: Pick<RunFacts, "events" | "append" | "state">;
	turns: Pick<Turns, "hold" | "forget" | "restore" | "continueTranscriptAfter">;
	handover: Pick<
		WalkHandover,
		"arriving" | "takeCheckpoint" | "takeTranscripts"
	>;
};

/**
 * This computer walks a run another Device moved here (`WalkerMoved`, the
 * other half of `moveRun`): its Checkpoint comes from the archive (this
 * Replica's, else the Host's) into this computer's walk state, its
 * transcript continues after the entries the archive keeps, and a
 * sleeping run gets its wake timer. A run at a Gate waits for its answer
 * here, a stopped one for a resume. Night Shift does it on its own when
 * the move lands here (`PeerRuns.takeOver`): it takes no actor.
 *
 * It ends with `WalkerArrived`, in a Turn of an arrival, so no answer,
 * wake or resume comes in between. Until that is in the log the run still
 * arrives: a take-over that fails, or that a restart cuts short, is done
 * again, and every step of it repeats safely. One of a run that already
 * arrived does nothing.
 */
export const arriveRun =
	(ports: ArriveRunPorts) =>
	async (runId: string): Promise<void> => {
		const { facts, turns, handover } = ports;
		await turns.hold(
			runId,
			async ({ row }) => {
				const events = await facts.events(runId);
				const moved = events.findLast((e) => e.type === "WalkerMoved");
				if (
					moved?.type !== "WalkerMoved" ||
					!(await handover.arriving(runId))
				) {
					return;
				}
				if (!(await handover.takeCheckpoint(row))) {
					throw new Error(NO_CHECKPOINT);
				}
				// The old Walker's transcript files are on its disk, not here:
				// each step's file starts as the archive's copy (a step reopened
				// or answered here goes on in it), and the next entry is
				// numbered after the last one the old Walker archived.
				const lastSeq = await handover.takeTranscripts(row);
				await facts.append({
					type: "WalkerArrived",
					runId,
					payload: { from: moved.payload.from },
				});
				turns.continueTranscriptAfter(runId, lastSeq);
				turns.forget(runId);
				turns.restore(runId, await facts.state(runId));
			},
			{ arrival: true },
		);
	};
