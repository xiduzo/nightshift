import { revokeKeys } from "../../application/revoke-keys";
import { createVerifiedKeys } from "../../domain/device-keys";
import { inMemoryKeyIssuer } from "./in-memory-key-issuer";
import { inMemoryKeyStore } from "./in-memory-key-store";

/**
 * `inMemoryDeviceKeysPorts`, which gives a use-case test every port of
 * device-keys at once. Test code: production code never imports this file.
 */

/**
 * Every port of device-keys in memory at once: where each use-case test
 * starts. The twins hash a key as `hash-<key>`. The clock is `clock.now`.
 * `revokeKeys` is bound to the same ports, as the wire binds it.
 */
export function inMemoryDeviceKeysPorts() {
	const clock = { now: 1_000_000 };
	const keyStore = inMemoryKeyStore();
	const ports = {
		keyStore,
		keyIssuer: inMemoryKeyIssuer(keyStore, () => clock.now),
		verified: createVerifiedKeys(),
		hash: async (key: string) => `hash-${key}`,
		idleDays: () => 30,
		now: () => clock.now,
	};
	return { ...ports, clock, revokeKeys: revokeKeys(ports) };
}
