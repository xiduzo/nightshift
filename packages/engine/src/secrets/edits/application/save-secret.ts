import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import {
	type ComputerSecrets,
	checkSecret,
	type KnownSecrets,
	type PersonalSecrets,
	type Reach,
	type SecretFacts,
	type SecretScope,
	saveIn,
} from "../../scopes";

/**
 * What a change in a scope of this computer's Person works on: this
 * computer's keychain and the Personal secrets.
 */
export type ScopePorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	computer: ComputerSecrets;
	facts: Pick<SecretFacts, "saved" | "writeSaved">;
	personal: Reach<Pick<PersonalSecrets, "values" | "set" | "remove">>;
	known: KnownSecrets;
	now: () => number;
};

/** A value to save, and where. Default: this computer. */
export type SaveSecret = { name: string; value: string; scope?: SecretScope };

/**
 * Saves a value in a scope: this computer's keychain (the document gets the
 * name and the time, never the value), or the Personal secrets. Only the
 * owner of this computer may.
 */
export const saveSecret =
	(ports: ScopePorts) =>
	async (
		actor: Actor,
		{ name, value, scope = "computer" }: SaveSecret,
	): Promise<void> => {
		ports.computerAccess.openComputer(actor);
		checkSecret(name, value);
		await saveIn(ports, scope, name, value);
	};
