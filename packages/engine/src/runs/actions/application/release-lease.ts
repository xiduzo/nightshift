import type { Access } from "../../../access";
import { type Actor, commandOf, permissionOf } from "../../../contract";
import type { RunFacts, Turns, Walkers } from "../../walk";
import { refuseRelease } from "../domain/action-rules";
import type { RunLeases } from "./ports";

export type ReleaseLeasePorts = {
	openRun: Access["openRun"];
	facts: Pick<RunFacts, "state" | "append" | "changed">;
	turns: Pick<Turns, "hold">;
	walkers: Pick<Walkers, "send">;
	leases: RunLeases;
};

/** Which run, in which Space when the caller holds one, and the lease's name. */
export type ReleaseLease = { runId: string; spaceId?: string; name: string };

/**
 * Lets go of a lease the run holds (ADR 7): the next run that waits for it
 * takes it. The run goes on, and does not take it again. The actor's role
 * must allow `run.stop` in the run's Space. A run another Device walks:
 * the release travels to its Walker as a Command, once the log here says
 * the run holds the lease. A run this computer walks: in a Turn that
 * drives nothing, the log says so first (`LeaseReleased`, why `person`),
 * so a resume does not take it back. Then its keeper frees it.
 */
export const releaseLease =
	(ports: ReleaseLeasePorts) =>
	async (actor: Actor, request: ReleaseLease): Promise<void> => {
		const { facts } = ports;
		const { runId: _, spaceId, ...fields } = request;
		const { name } = request;
		const { run, walkedHere } = await ports.openRun(actor, {
			runId: request.runId,
			spaceId,
			need: permissionOf("release-lease"),
		});
		if (!walkedHere) {
			refuseRelease(await facts.state(run.id), name);
			const command = commandOf({ kind: "release-lease", ...fields });
			if (command) await ports.walkers.send(run, actor, command);
			return;
		}
		await ports.turns.hold(run.id, async ({ runState }) => {
			refuseRelease(runState, name);
			await facts.append({
				type: "LeaseReleased",
				runId: run.id,
				payload: { name, why: "person" },
			});
			facts.changed(run.id);
		});
		await ports.leases.release(run.id, [name]);
	};
