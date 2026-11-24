import type { openWork } from "../../../graph";
import type { foldRun } from "../../../log";
import type { Turns } from "../../walk";
import { interruptedReason } from "../domain/resume-block";
import type { checkResume } from "./check-resume";
import type { OpenWork } from "./ports";

export type RecoverRunsPorts = {
	openWork: OpenWork;
	turns: Pick<Turns, "take" | "restore">;
	/** Why nothing can continue the run: an older Night Shift made its flow. Null: it did not. */
	olderRun(runId: string): Promise<string | null>;
	/** Why a run does not continue on its own, or null. */
	checkResume: ReturnType<typeof checkResume>;
	/** The run's state from its events (`log`). */
	fold: typeof foldRun;
	/** What a cut of the run would end: its open steps and sessions, and whether it ends the run (`graph`). */
	whatIsOpen: typeof openWork;
};

/**
 * Startup recovery: what a new daemon does about the runs the last one
 * left open on this computer. A daemon that died left sessions, steps and
 * runs open. They become `interrupted` as a stop ends them. A run that
 * ends so keeps only the checkpoints a re-entry reads. A sleeping run gets
 * its timer back: a wake time in the past fires at once. Open Gates and
 * sleeping steps are facts, not lost work. A step past its time budget or
 * idle limit ends as its timer would have ended it, and that run fails.
 * A run whose flow an older Night Shift made ends interrupted with its
 * Gates and its sleeps: nothing can continue it.
 *
 * Returns the runs that continue on their own after the grace. A run that
 * does not continue says why in its end reason, and lets go of what it
 * holds.
 */
export const recoverRuns =
	(ports: RecoverRunsPorts) => async (): Promise<string[]> => {
		const { openWork, turns } = ports;
		const toResume: string[] = [];
		for (const [runId, events] of await openWork.walkedHere()) {
			// The lifecycle events are enough to see what is open.
			const runState = ports.fold(events);
			const all = { kind: "interrupted", waits: true } as const;
			if (ports.whatIsOpen(runState, all).endsRun) {
				const older = await ports.olderRun(runId);
				if (older !== null) {
					await openWork.close(runId, { ...all, reason: older });
					await letGo(openWork, runId);
					continue;
				}
			}
			const open = ports.whatIsOpen(runState, { kind: "interrupted" });
			// A step that ran past its time budget or idle limit meanwhile
			// ends as its timer would have ended it, and the run fails: it
			// does not continue.
			if (
				open.endsRun &&
				open.steps.length > 0 &&
				(await turns.take(runId, { kind: "overdue", graceMs: 0 })).kind ===
					"halted"
			) {
				continue;
			}
			const why = open.endsRun
				? await ports.checkResume(runId, runState)
				: null;
			if (open.endsRun || open.steps.length > 0 || open.sessions.length > 0) {
				// The open work ends as a stop ends it, from the run's whole
				// log: a Call with `each` counts its items.
				await openWork.close(runId, {
					kind: "interrupted",
					reason: interruptedReason(why),
				});
			}
			// A run that ended so keeps only what a re-entry reads, as a
			// drive's end leaves it. A run whose flow cannot be read keeps
			// its history: recovery goes on with the next run.
			if (open.endsRun) {
				await turns.take(runId, { kind: "prune" }).catch((error) => {
					console.warn(`[engine] could not prune run ${runId}`, error);
				});
			}
			if (open.endsRun && !why) toResume.push(runId);
			if (open.endsRun && why) await letGo(openWork, runId);
			// A sleeping run gets its timer back from the log.
			if (!open.endsRun) turns.restore(runId, runState);
		}
		return toResume;
	};

/** An interrupted run that does not continue lets go of what it holds. A failure is logged: a lease expires. */
async function letGo(
	openWork: Pick<OpenWork, "letGo">,
	runId: string,
): Promise<void> {
	try {
		await openWork.letGo(runId);
	} catch (error) {
		console.warn(`[engine] could not let go of what run ${runId} holds`, error);
	}
}
