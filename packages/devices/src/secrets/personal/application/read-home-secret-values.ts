import type { Caller } from "../../../contract";
import type { PersonalSecretStore } from "../../kept";
import { ownerOf } from "../domain/personal-secrets";

export type ReadHomeSecretValuesPorts = {
	store: Pick<PersonalSecretStore, "values">;
};

/** The names whose values the Device asks for. */
export type ReadHomeSecretValues = { names: readonly string[] };

/**
 * Gives the values of these names of the calling Device's Person, as
 * their Home Host.
 *
 * A paired Device asks: the use case takes the Caller.
 */
export const readHomeSecretValues =
	(ports: ReadHomeSecretValuesPorts) =>
	async (
		caller: Caller,
		request: ReadHomeSecretValues,
	): Promise<Record<string, string>> =>
		ports.store.values(ownerOf(caller), request.names);
