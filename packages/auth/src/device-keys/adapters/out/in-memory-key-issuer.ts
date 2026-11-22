import type { KeyIssuer } from "../../application/ports";
import type { StoredKey } from "../../domain/device-keys";
import type { InMemoryKeyStore } from "./in-memory-key-store";

/**
 * `KeyIssuer` in memory. A new key goes into the key store twin under the
 * hash `hash-<key>`, as the plugin stores its hash. `now` is the twin's
 * clock for the expiry.
 */
export function inMemoryKeyIssuer(
	store: Pick<InMemoryKeyStore, "add">,
	now: () => number,
) {
	let next = 0;
	const twin = {
		/** Every key made, in order. */
		made: [] as StoredKey[],
		async create(key: {
			personId: string;
			name: string;
			deviceId: string;
			permissions: Record<string, string[]>;
			expiresIn: number;
		}) {
			next += 1;
			const made: StoredKey = {
				id: `key-${next}`,
				personId: key.personId,
				enabled: true,
				expiresAt: now() + key.expiresIn * 1000,
				permissions: key.permissions,
				deviceId: key.deviceId,
			};
			const clear = `nsd_${key.deviceId}-${next}`;
			store.add(`hash-${clear}`, made);
			twin.made.push(made);
			return { key: clear, keyId: made.id };
		},
	};
	return twin satisfies KeyIssuer;
}

export type InMemoryKeyIssuer = ReturnType<typeof inMemoryKeyIssuer>;
