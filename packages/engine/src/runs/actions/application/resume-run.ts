import type { Access } from "../../../access";
import { type Actor, commandOf, permissionOf } from "../../../contract";
import type { takesPrompt } from "../../../read";
import { RunRefusal, refuseUnless } from "../../../run-status";
import type { RunFacts, StartHolds, Turns, Walkers } from "../../walk";
import { RESUME_ON_ITS_WAY, refusePrompt } from "../domain/action-rules";

export type ResumeRunPorts = {
	openRun: Access["openRun"];
	facts: Pick<RunFacts, "state">;
	turns: Pick<Turns, "take">;
	walkers: Pick<Walkers, "send" | "pending">;
	/** A resume makes the run active: refused while its Space's Projects move. */
	holds: Pick<StartHolds, "start">;
	takesPrompt: typeof takesPrompt;
};

/** Which run, in which Space when the caller holds one, and what an Agent node continues with. */
export type ResumeRun = { runId: string; spaceId?: string; prompt?: string };

/**
 * Continues a stopped, failed or interrupted run at its last step, or
 * wakes a sleeping one. The actor's role must allow `run.resume` in the
 * run's Space. A run another Device walks: the resume travels to its
 * Walker as a Command, once the status rule allows it and no other
 * resume is on its way. A run this computer walks: a Turn of the runner
 * (`RunResumed` before the thread moves), refused while the Space's
 * Projects move. A prompt that no session takes is refused, so the run stays
 * as it was and the person still has their text. A Command that came here
 * with one is not refused: nobody reads its refusal, so the run continues.
 */
export const resumeRun =
	(ports: ResumeRunPorts) =>
	async (actor: Actor, request: ResumeRun): Promise<void> => {
		const { facts, turns, walkers } = ports;
		const { runId: _, spaceId, ...fields } = request;
		const { run, walkedHere } = await ports.openRun(actor, {
			runId: request.runId,
			spaceId,
			need: permissionOf("resume"),
		});
		if (!walkedHere) {
			const runState = await facts.state(run.id);
			refuseUnless(
				"resume",
				runState.status,
				false,
				runState.end?.result ?? null,
			);
			if ((await walkers.pending(run.id)).includes("run.resume")) {
				throw new RunRefusal("not-now", RESUME_ON_ITS_WAY);
			}
			if (request.prompt !== undefined)
				refusePrompt(ports.takesPrompt(runState));
			const command = commandOf({ kind: "resume", ...fields });
			if (command) await walkers.send(run, actor, command);
			return;
		}
		const { prompt } = request;
		const byCommand = "door" in actor && actor.door === "command";
		// `RunResumed` before the thread moves; a sleeping run wakes.
		await ports.holds.start(run.spaceId, () =>
			turns.take(
				run.id,
				{
					kind: "resume",
					by: "person",
					...(prompt !== undefined ? { prompt } : {}),
				},
				{
					check: (runState) => {
						refuseUnless("resume", runState.status, true, runState.end?.result);
						if (prompt !== undefined && !byCommand)
							refusePrompt(ports.takesPrompt(runState));
					},
				},
			),
		);
	};
