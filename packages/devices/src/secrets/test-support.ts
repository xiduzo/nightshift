import type { PersonalSecrets } from "@nightshift/engine/device-config";
import type { DeviceLinks, HostLinks } from "../links";
import { wireCalls } from "./calls";
import type { PersonalSecretStore } from "./kept";
import { drizzlePersonalSecretStore } from "./kept/adapters/out/drizzle-personal-secret-store";
import { drizzleProjectSecretStore } from "./kept/adapters/out/drizzle-project-secret-store";
import { drizzleSpaceSecretStore } from "./kept/adapters/out/drizzle-space-secret-store";
import { webcryptoSecretsCipher } from "./kept/adapters/out/webcrypto-secrets-cipher";
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
		calls: wireCalls({
			hostLinks: { home: async () => null },
			links: () => ({ get: () => undefined }),
		}),
		ownerId: "",
		selfId: "",
	}).host;
}

export {
	NOT_YOUR_HOME_HOST,
	OLDER_HOST_SECRETS,
} from "./personal/domain/personal-secrets";
