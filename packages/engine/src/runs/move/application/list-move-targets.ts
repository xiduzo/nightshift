import type { Actor, OwnDevice } from "../../../contract";
import type { Access } from "../../access";
import { movable, signedOut } from "../domain/move-rules";
import type { MoveDevices } from "./ports";

export type ListMoveTargetsPorts = {
	openRun: Access["openRun"];
	devices: Pick<MoveDevices, "own">;
};

/** Which run, in which Space when the caller holds one. */
export type ListMoveTargets = { runId: string; spaceId?: string };

/**
 * The Person's own Devices the run can move to: online, and not its
 * Walker. From the run's own Space, whichever Space the person works in.
 * Another Person's Device takes steps through its Offers, never a walk.
 * The actor must be a Member of the run's Space, and a Person.
 */
export const listMoveTargets =
	(ports: ListMoveTargetsPorts) =>
	async (actor: Actor, request: ListMoveTargets): Promise<OwnDevice[]> => {
		const { run, walkedHere } = await ports.openRun(actor, {
			runId: request.runId,
			spaceId: request.spaceId,
		});
		if (!("personId" in actor)) throw signedOut();
		return movable(await ports.devices.own(run, actor), run, walkedHere);
	};
