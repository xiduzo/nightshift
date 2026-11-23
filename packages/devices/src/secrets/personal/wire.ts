import type { PersonalSecrets } from "@nightshift/engine/device-config";
import type { Caller, PersonalSecretName } from "../../contract";
import type { HostCalls } from "../calls";
import type { PersonalSecretStore } from "../kept";
import { listHomeSecrets } from "./application/list-home-secrets";
import { listPersonalSecrets } from "./application/list-personal-secrets";
import { readHomeSecretValues } from "./application/read-home-secret-values";
import { readPersonalSecretValues } from "./application/read-personal-secret-values";
import { removeHomeSecret } from "./application/remove-home-secret";
import { removePersonalSecret } from "./application/remove-personal-secret";
import { saveHomeSecret } from "./application/save-home-secret";
import { savePersonalSecret } from "./application/save-personal-secret";
import { PERSONAL_DEADLINE_MS } from "./domain/personal-secrets";

/**
 * The wiring of the Personal secrets: it binds each use case to the
 * store and the Host calls. It builds no adapter of its own.
 */

/** What the composition gives the Personal secrets. */
export type PersonalDeps = {
	store: PersonalSecretStore;
	calls: HostCalls;
	/** The Person who owns this computer: whose secrets it keeps without a Home Host. */
	ownerId: string;
	/** This computer's Device: the one that set a value it keeps itself. */
	selfId: string;
	/** How long one call of the Home Host may take. Default: `PERSONAL_DEADLINE_MS`. */
	deadlineMs?: number;
};

/**
 * This computer as a Home Host, as a paired Device asks it for its
 * Person's Personal secrets (ADR 13, decisions 2, 3 and 5). The Host
 * admitted the Caller before the call reached here (`Devices.admit`):
 * "Be a Host" is on, and its Device is paired here with access, as its
 * Person's own. Each call adds one check: the Device joined this Host
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

/**
 * The Personal secrets, both halves. `device` is the engine's
 * `PersonalSecrets` port (ADR 13): with a Home Host, each call goes to
 * that Host over its link, with this Device's key, and nothing is kept
 * here. Without one, this computer keeps them itself, for its owner. A
 * Host that cannot be reached, or does not answer in time, throws
 * `HostUnreachableError`: a step then reads the secret as missing.
 */
export type Personal = { host: PersonalSecretsHost; device: PersonalSecrets };

export function wirePersonal(deps: PersonalDeps): Personal {
	const { store } = deps;
	const ports = {
		store,
		calls: deps.calls,
		ownerId: deps.ownerId,
		selfId: deps.selfId,
		deadlineMs: deps.deadlineMs ?? PERSONAL_DEADLINE_MS,
	};
	const list = listPersonalSecrets(ports);
	const values = readPersonalSecretValues(ports);
	const set = savePersonalSecret(ports);
	const remove = removePersonalSecret(ports);
	return {
		host: {
			list: listHomeSecrets({ store }),
			values: readHomeSecretValues({ store }),
			set: saveHomeSecret({ store }),
			remove: removeHomeSecret({ store }),
		},
		device: {
			list: () => list(),
			values: (names) => values({ names }),
			set: (name, value) => set({ name, value }),
			remove: (name) => remove({ name }),
		},
	};
}
