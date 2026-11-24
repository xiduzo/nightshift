import type { Actor } from "../../../contract";
import { NotComputerOwner } from "../domain/refusals";
import type { ComputerOwner } from "./ports";

export type OpenComputerPorts = { owner: ComputerOwner };

/**
 * Opens this computer for the actor, for a request about its settings, its
 * programs or its disk: they are the owner's, in any Space, whatever the
 * role. Another Person is refused (`NotComputerOwner`). Night Shift itself
 * may act. It answers at once, so a synchronous use case can ask it.
 */
export const openComputer =
	(ports: OpenComputerPorts) =>
	(actor: Actor): void => {
		if ("personId" in actor && actor.personId !== ports.owner.id()) {
			throw new NotComputerOwner();
		}
	};
