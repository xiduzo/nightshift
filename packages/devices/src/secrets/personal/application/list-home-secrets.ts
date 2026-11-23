import type { Caller, PersonalSecretName } from "../../../contract";
import type { PersonalSecretStore } from "../../kept";
import { ownerOf } from "../domain/personal-secrets";

export type ListHomeSecretsPorts = {
	store: Pick<PersonalSecretStore, "list">;
};

/**
 * Lists the names of the calling Device's Person's Personal secrets, as
 * their Home Host. A call never names whose: the Caller's Person's only.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const listHomeSecrets =
	(ports: ListHomeSecretsPorts) =>
	async (caller: Caller): Promise<PersonalSecretName[]> =>
		ports.store.list(ownerOf(caller));
