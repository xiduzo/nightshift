import type { Actor } from "../../../contract";
import type { SavedProfiles } from "./ports";

export type RemoveProfilePorts = { saved: Pick<SavedProfiles, "remove"> };

/**
 * Removes a profile. Flows that name it do not start until they name
 * another. The owner of this computer may remove it: its door checks that
 * (`ownerProcedure`), so the actor is not read here.
 */
export const removeProfile =
	(ports: RemoveProfilePorts) =>
	async (_actor: Actor, request: { id: string }): Promise<void> => {
		await ports.saved.remove(request.id);
	};
