import { type Actor, commandOf, permissionOf } from "../../../contract";
import type { Access } from "../../access";
import type { RunFacts, Turns, Walkers } from "../../walk";
import { refuseSignal } from "../domain/action-rules";

export type SendSignalPorts = {
	openRun: Access["openRun"];
	facts: Pick<RunFacts, "state">;
	turns: Pick<Turns, "take">;
	walkers: Pick<Walkers, "send">;
};

/** Which run, in which Space when the caller holds one, and the Signal's name. */
export type SendSignal = { runId: string; spaceId?: string; name: string };

/**
 * Sends a run the Signal its Wait node waits for: the step ends `done`
 * and the walk goes on. The actor's role must allow `signal.send` in the
 * run's Space. A run another Device walks: the Signal travels to its
 * Walker as a Command, once the log here says the run waits for it. A run
 * this computer walks: a wake a person asks for, as a Turn of the runner
 * (a full run cap refuses it). The rule runs inside the Turn.
 */
export const sendSignal =
	(ports: SendSignalPorts) =>
	async (actor: Actor, request: SendSignal): Promise<void> => {
		const { runId: _, spaceId, ...fields } = request;
		const { name } = request;
		const { run, walkedHere } = await ports.openRun(actor, {
			runId: request.runId,
			spaceId,
			need: permissionOf("signal"),
		});
		if (!walkedHere) {
			refuseSignal(await ports.facts.state(run.id), name);
			const command = commandOf({ kind: "signal", ...fields });
			if (command) await ports.walkers.send(run, actor, command);
			return;
		}
		await ports.turns.take(
			run.id,
			{ kind: "wake", early: true, signal: name },
			{ check: (runState) => refuseSignal(runState, name) },
		);
	};
