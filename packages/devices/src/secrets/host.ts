import { Refusal } from "@nightshift/refusal";
import type { Caller, PersonalSecretName } from "../contract";
import type { PersonalSecretStore } from "./store";

/** The refusal of a Device that joined this Host as a guest: its Personal secrets stay with its Home Host. */
export const NOT_YOUR_HOME_HOST =
	"This computer keeps no Personal secrets for you. They stay with your home Host.";

/**
 * This computer as a Home Host, as a paired Device asks it for its
 * Person's Personal secrets (ADR 13, decisions 2, 3 and 5). The Host
 * admitted the Caller before the call reached here (`Devices.admit`):
 * "Be a Host" is on, and its Device is paired here with access, as its
 * Person's own. This module adds one check: the Device joined this Host
 * as its Home Host. A Guest Host keeps no Personal secret and gives none.
 *
 * Then it serves the Caller's Person's secrets only: a call never names
 * whose. A step of another Person's run never reaches here for them: a
 * Device asks with its own key, so it gets its own owner's secrets at
 * most.
 */
export type PersonalSecretsHost = {
	list(caller: Caller): Promise<PersonalSecretName[]>;
	values(
		caller: Caller,
		input: { names: readonly string[] },
	): Promise<Record<string, string>>;
	set(caller: Caller, input: { name: string; value: string }): Promise<void>;
	remove(caller: Caller, input: { name: string }): Promise<void>;
};

export function createPersonalSecretsHost(deps: {
	store: PersonalSecretStore;
}): PersonalSecretsHost {
	/** The Person whose secrets the Caller's Device may use: its own, when this is its Home Host. */
	function ownerOf(caller: Caller): string {
		if (caller.device.homeHost === null) {
			throw new Refusal("forbidden", NOT_YOUR_HOME_HOST);
		}
		return caller.personId;
	}
	return {
		list: async (caller) => deps.store.list(ownerOf(caller)),
		values: async (caller, { names }) =>
			deps.store.values(ownerOf(caller), names),
		set: async (caller, { name, value }) =>
			deps.store.set(ownerOf(caller), name, value, caller.deviceId),
		remove: async (caller, { name }) =>
			deps.store.remove(ownerOf(caller), name),
	};
}
