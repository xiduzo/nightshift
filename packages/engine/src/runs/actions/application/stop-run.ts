import { type Actor, commandOf, permissionOf } from "../../../contract";
import type { Access } from "../../access";
import type { RunFacts, Turns, Walkers } from "../../walk";
import { stopAfterStepEvent, stopTravels } from "../domain/action-rules";

export type StopRunPorts = {
	openRun: Access["openRun"];
	facts: Pick<RunFacts, "state" | "append" | "changed">;
	turns: Pick<Turns, "take" | "hold">;
	walkers: Pick<Walkers, "send">;
};

/** Which run, in which Space when the caller holds one, and when it stops. */
export type StopRun = {
	runId: string;
	spaceId?: string;
	/**
	 * `now` (default): the run stops at once. `after-step`: after its
	 * running step. `cancel-after-step`: withdraws an `after-step` stop.
	 */
	when?: "now" | "after-step" | "cancel-after-step";
};

/**
 * Stops a run, now or after its running step. The actor's role must allow
 * `run.stop` in the run's Space. A run another Device walks: the stop
 * travels to its Walker as a Command, unless the run ended (nothing to
 * stop). A run this computer walks: a stop now is a Turn of the runner,
 * a stop after the step is logged in a Turn that drives nothing.
 */
export const stopRun =
	(ports: StopRunPorts) =>
	async (actor: Actor, request: StopRun): Promise<void> => {
		const { facts, turns } = ports;
		const { runId: _, spaceId, ...fields } = request;
		const { run, walkedHere } = await ports.openRun(actor, {
			runId: request.runId,
			spaceId,
			need: permissionOf("stop"),
		});
		if (!walkedHere) {
			// A run that has ended has nothing to stop.
			if (!stopTravels(await facts.state(run.id))) return;
			const command = commandOf({ kind: "stop", ...fields });
			if (command) await ports.walkers.send(run, actor, command);
			return;
		}
		const { when } = request;
		if (when !== "after-step" && when !== "cancel-after-step") {
			await turns.take(run.id, { kind: "stop", by: "person" });
			return;
		}
		await turns.hold(run.id, async ({ runState }) => {
			const type = stopAfterStepEvent(runState, when === "after-step");
			if (type === null) return;
			await facts.append({ type, runId: run.id, payload: {} });
			facts.changed(run.id);
		});
	};
