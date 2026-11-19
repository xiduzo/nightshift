import { type Actor, commandOf, permissionOf } from "../../../contract";
import type { deriveSteps } from "../../../read";
import { refuseUnless } from "../../../run-status";
import type { Access } from "../../access";
import type { RunFacts, StartHolds, Turns, Walkers } from "../../walk";
import { refuseRestart } from "../domain/action-rules";

export type RestartStepPorts = {
	openRun: Access["openRun"];
	facts: Pick<RunFacts, "state">;
	turns: Pick<Turns, "take">;
	walkers: Pick<Walkers, "send">;
	/** A restart makes the run active: refused while its Space's Projects move. */
	holds: Pick<StartHolds, "start">;
	/** The steps of a run, from its state (`read/`). */
	deriveSteps: typeof deriveSteps;
};

/** Which run, in which Space when the caller holds one, which step, and what an Agent node continues with. */
export type RestartStep = {
	runId: string;
	spaceId?: string;
	/** The step that must be the one that runs. Absent: whichever runs. */
	stepId?: string;
	prompt?: string;
};

/**
 * Stops the running step and continues it at once, as a stop now and a
 * resume would, in one Turn: nothing comes in between, and the run keeps
 * its slot. The actor's role must allow `run.stop` and `run.resume` in the
 * run's Space. Only the Walker restarts: a run another Device walks is
 * refused (`walked-elsewhere`). Refused while the Space's Projects move.
 */
export const restartStep =
	(ports: RestartStepPorts) =>
	async (actor: Actor, request: RestartStep): Promise<void> => {
		const { facts, turns } = ports;
		const { runId: _, spaceId, ...fields } = request;
		const { run, walkedHere } = await ports.openRun(actor, {
			runId: request.runId,
			spaceId,
			need: permissionOf("restart"),
		});
		if (!walkedHere) {
			const runState = await facts.state(run.id);
			// Only the Walker restarts: the status rule says so.
			refuseUnless(
				"restart",
				runState.status,
				false,
				runState.end?.result ?? null,
			);
			const command = commandOf({ kind: "restart", ...fields });
			if (command) await ports.walkers.send(run, actor, command);
			return;
		}
		const { stepId, prompt } = request;
		await ports.holds.start(run.spaceId, () =>
			turns.take(
				run.id,
				{
					kind: "restart",
					by: "person",
					...(prompt !== undefined ? { prompt } : {}),
				},
				{
					check: (runState) =>
						refuseRestart(runState, ports.deriveSteps(runState), stepId),
				},
			),
		);
	};
