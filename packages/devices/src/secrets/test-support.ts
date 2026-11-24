import { createWorkHub } from "../work";
import { type KeepDeps, type SecretsDeps, wireSecrets } from "./wire";

/** The secrets key of the database tests of this folder. */
export const KEY = "a-secrets-key-for-these-tests-0123456789";

/**
 * This computer's secrets through the real wire (`wireSecrets`), for the
 * database tests of this folder. A test names what it needs: without it,
 * this computer has no Host, no links, no Devices and no calls of runs.
 */
export function secretsOf(
	deps: Partial<SecretsDeps> & Pick<KeepDeps, "db"> & Partial<KeepDeps>,
) {
	return wireSecrets({
		hostLinks: { home: async () => null },
		own: undefined,
		ownerId: "",
		...deps,
	}).keep({
		secretsKey: KEY,
		selfId: "",
		links: () => ({ get: () => undefined }),
		places: { spaceOf: async () => null, runPlace: async () => null },
		hostOf: async () => null,
		devices: { get: async () => null },
		work: createWorkHub(),
		offersInto: async () => false,
		...deps,
	});
}
