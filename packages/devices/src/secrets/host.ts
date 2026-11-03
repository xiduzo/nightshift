import type { DeviceKeyAccess } from "@nightshift/auth";
import { Refusal } from "@nightshift/refusal";
import { NOT_A_HOST, type PersonalSecretName } from "../contract";
import type { DeviceRegistry } from "../registry";
import type { PersonalSecretStore } from "./store";

/** The refusal of a Device that is not one of the Person's own here, with access. */
export const NOT_YOUR_DEVICE = "This device has no access here. Pair it again.";

/** The refusal of a Device that joined this Host as a guest: its Personal secrets stay with its Home Host. */
export const NOT_YOUR_HOME_HOST =
	"This computer keeps no Personal secrets for you. They stay with your home Host.";

/**
 * This computer as a Home Host, as a paired Device asks it for its
 * Person's Personal secrets (ADR 13, decisions 2, 3 and 5). Every call
 * checks, from this Host's own registry, that:
 *
 * - "Be a Host" is on;
 * - the key's Device is paired here and has access;
 * - its owner here is the key's Person: the Person's own Device;
 * - it joined this Host as its Home Host. A Guest Host keeps no Personal
 *   secret and gives none.
 *
 * Then it serves the key's Person's secrets only: a call never names whose.
 * A step of another Person's run never reaches here for them: a Device
 * asks with its own key, so it gets its own owner's secrets at most.
 */
export type PersonalSecretsHost = {
	list(key: DeviceKeyAccess): Promise<PersonalSecretName[]>;
	values(
		key: DeviceKeyAccess,
		input: { names: readonly string[] },
	): Promise<Record<string, string>>;
	set(
		key: DeviceKeyAccess,
		input: { name: string; value: string },
	): Promise<void>;
	remove(key: DeviceKeyAccess, input: { name: string }): Promise<void>;
};

export function createPersonalSecretsHost(deps: {
	registry: Pick<DeviceRegistry, "get">;
	store: PersonalSecretStore;
	/** "Be a Host" is on now. */
	isHost(): boolean;
}): PersonalSecretsHost {
	/** The Person whose secrets the key's Device may use, after every check. */
	async function ownerOf(key: DeviceKeyAccess): Promise<string> {
		if (!deps.isHost()) throw new Refusal("unavailable", NOT_A_HOST);
		const paired = await deps.registry.get(key.deviceId);
		if (
			!paired ||
			paired.revokedAt !== null ||
			paired.ownerId !== key.personId
		) {
			throw new Refusal("forbidden", NOT_YOUR_DEVICE);
		}
		if (paired.homeHost === null) {
			throw new Refusal("forbidden", NOT_YOUR_HOME_HOST);
		}
		return key.personId;
	}
	return {
		list: async (key) => deps.store.list(await ownerOf(key)),
		values: async (key, { names }) =>
			deps.store.values(await ownerOf(key), names),
		set: async (key, { name, value }) =>
			deps.store.set(await ownerOf(key), name, value, key.deviceId),
		remove: async (key, { name }) =>
			deps.store.remove(await ownerOf(key), name),
	};
}
