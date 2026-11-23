import type { Caller } from "../../../contract";
import type { PersonalSecretStore } from "../../kept";
import { ownerOf } from "../domain/personal-secrets";

export type SaveHomeSecretPorts = {
	store: Pick<PersonalSecretStore, "set">;
};

/** The secret to save. */
export type SaveHomeSecret = { name: string; value: string };

/**
 * Saves or replaces a Personal secret of the calling Device's Person, as
 * their Home Host. The Device that set it is the Caller's.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const saveHomeSecret =
	(ports: SaveHomeSecretPorts) =>
	async (caller: Caller, request: SaveHomeSecret): Promise<void> =>
		ports.store.set(
			ownerOf(caller),
			request.name,
			request.value,
			caller.deviceId,
		);
