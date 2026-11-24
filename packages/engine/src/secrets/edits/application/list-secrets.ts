import type { ComputerAccess } from "../../../access";
import type { Actor } from "../../../contract";
import {
	type KnownSecrets,
	listPersonalNames,
	type PersonalSecrets,
	type Reach,
	type SecretEnvironment,
	type SecretFacts,
	type SecretList,
	type SecretReferences,
	secretRows,
} from "../../scopes";

export type ListSecretsPorts = {
	computerAccess: Pick<ComputerAccess, "openComputer">;
	facts: Pick<SecretFacts, "saved" | "usedAt">;
	references: SecretReferences;
	personal: Reach<Pick<PersonalSecrets, "list">>;
	known: KnownSecrets;
	env: SecretEnvironment;
};

/** More names to list: a Command node's. */
export type ListSecrets = { named?: Iterable<string> };

/**
 * Lists the secrets: the Personal ones, this computer's saved ones, the
 * ones connections reference and `named`, with where each is set and when.
 * Names and times only, never a value. Only the owner of this computer may.
 */
export const listSecrets =
	(ports: ListSecretsPorts) =>
	async (actor: Actor, { named = [] }: ListSecrets): Promise<SecretList> => {
		ports.computerAccess.openComputer(actor);
		const personal = await listPersonalNames(ports);
		return secretRows({
			personal,
			usedBy: ports.references.usedBy(),
			saved: ports.facts.saved(),
			used: ports.facts.usedAt(),
			env: ports.env,
			named,
		});
	};
