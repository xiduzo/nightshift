import type { Caller } from "../../../contract";
import type { PersonalSecretStore } from "../../kept";
import { ownerOf } from "../domain/personal-secrets";

export type RemoveHomeSecretPorts = {
	store: Pick<PersonalSecretStore, "remove">;
};

/** The secret to remove. */
export type RemoveHomeSecret = { name: string };

/**
 * Removes a Personal secret of the calling Device's Person, as their
 * Home Host.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const removeHomeSecret =
	(ports: RemoveHomeSecretPorts) =>
	async (caller: Caller, request: RemoveHomeSecret): Promise<void> =>
		ports.store.remove(ownerOf(caller), request.name);
