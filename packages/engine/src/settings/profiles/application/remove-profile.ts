import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import type { SavedProfiles } from "./ports";

export type RemoveProfilePorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	saved: Pick<SavedProfiles, "remove">;
};

/**
 * Removes a profile. Flows that name it do not start until they name
 * another. Only the owner of this computer may remove it
 * (`computerAccess.openComputer`).
 */
export const removeProfile =
	(ports: RemoveProfilePorts) =>
	async (actor: Actor, request: { id: string }): Promise<void> => {
		ports.computerAccess.openComputer(actor);
		await ports.saved.remove(request.id);
	};
