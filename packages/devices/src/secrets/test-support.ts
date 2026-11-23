import type { PersonalSecrets } from "@nightshift/engine/device-config";
import type { DeviceLinks, HostLinks } from "../links";
import { wireCalls } from "./calls";
import type { PersonalSecretStore } from "./kept";
import { drizzlePersonalSecretStore } from "./kept/adapters/out/drizzle-personal-secret-store";
import { drizzleProjectSecretStore } from "./kept/adapters/out/drizzle-project-secret-store";
import { drizzleSpaceSecretStore } from "./kept/adapters/out/drizzle-space-secret-store";
import { webcryptoSecretsCipher } from "./kept/adapters/out/webcrypto-secrets-cipher";
import {
	type OwnSecrets,
	type SecretMoves,
	type SecretMovesHost,
	wireMoves,
} from "./moves";
import type { MoveWork, OtherDevices } from "./moves/application/ports";
import { type PersonalSecretsHost, wirePersonal } from "./personal";

/**
 * The old names of the secrets, for the database tests of this folder
 * (`secrets.test.ts`, `project-secrets.test.ts`, `moves.test.ts`). They
 * build what the slice's wire builds, with the same arguments as before.
 */

export const secretsCipher = webcryptoSecretsCipher;
export const createPersonalSecretStore = drizzlePersonalSecretStore;
export const createProjectSecretStore = drizzleProjectSecretStore;
export const createSpaceSecretStore = drizzleSpaceSecretStore;

/** No link: a half that never calls a Host. */
const noLinks = () => ({ get: () => undefined });

/** No Host at all. */
const noHostCalls = wireCalls({
	hostLinks: { home: async () => null },
	links: noLinks,
});

/** The Device's half of the Personal secrets, with the old arguments. */
export function devicePersonalSecrets(deps: {
	hostLinks: Pick<HostLinks, "home">;
	links(): Pick<DeviceLinks, "get">;
	store: PersonalSecretStore;
	ownerId: string;
	selfId: string;
	deadlineMs?: number;
}): PersonalSecrets {
	const { hostLinks, links, ...rest } = deps;
	return wirePersonal({ ...rest, calls: wireCalls({ hostLinks, links }) })
		.device;
}

/** The Home Host's half of the Personal secrets, with the old arguments. */
export function createPersonalSecretsHost(deps: {
	store: PersonalSecretStore;
}): PersonalSecretsHost {
	return wirePersonal({
		store: deps.store,
		calls: noHostCalls,
		ownerId: "",
		selfId: "",
	}).host;
}

export {
	NOT_YOUR_HOME_HOST,
	OLDER_HOST_SECRETS,
} from "./personal/domain/personal-secrets";

/** The Home Host's half of the moves, with the old arguments. */
export function createSecretMovesHost(deps: {
	registry: OtherDevices;
	work: MoveWork;
	deadlineMs?: number;
	self: { id: string; ownerId: string; own: OwnSecrets | undefined };
}): SecretMovesHost {
	return wireMoves({
		calls: noHostCalls,
		own: deps.self.own,
		ownerId: deps.self.ownerId,
	}).relay({ ...relayOf(deps), selfId: deps.self.id }).host;
}

/** The owner's moves from this computer, with the old arguments. */
export function deviceSecretMoves(deps: {
	registry: OtherDevices;
	work: MoveWork;
	deadlineMs?: number;
	hostLinks: Pick<HostLinks, "home">;
	links(): Pick<DeviceLinks, "get">;
	ownerId: string;
}): SecretMoves {
	return wireMoves({
		calls: wireCalls({ hostLinks: deps.hostLinks, links: deps.links }),
		own: undefined,
		ownerId: deps.ownerId,
	}).relay({ ...relayOf(deps), selfId: "" }).device;
}

/** The Device with the value: it serves its Home Host's secret calls, with the old arguments. */
export function serveSecretCall(deps: {
	hostLinks: Pick<HostLinks, "home">;
	own: OwnSecrets | undefined;
	ownerId: string;
}) {
	return wireMoves({
		calls: wireCalls({ hostLinks: deps.hostLinks, links: noLinks }),
		own: deps.own,
		ownerId: deps.ownerId,
	}).serve;
}

function relayOf(deps: {
	registry: OtherDevices;
	work: MoveWork;
	deadlineMs?: number;
}) {
	return deps.deadlineMs === undefined
		? { devices: deps.registry, work: deps.work }
		: { devices: deps.registry, work: deps.work, deadlineMs: deps.deadlineMs };
}

export {
	NOT_HOME_FOR_MOVES,
	NOT_YOUR_OTHER_DEVICE,
	OLDER_HOST_MOVES,
	ONLY_FOR_OWNER,
	ONLY_FROM_HOME,
} from "./moves/domain/secret-moves";
export type { OwnSecrets };
