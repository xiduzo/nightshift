import type { KeyStore } from "../../application/ports";
import type { StoredKey } from "../../domain/device-keys";

/**
 * `KeyStore` in memory: the keys by their hash. A test adds a key (`add`)
 * where the real adapter would find one, and counts `reads` and `writes`.
 */
export function inMemoryKeyStore() {
	const keys = new Map<string, StoredKey>();
	const twin = {
		keys,
		reads: 0,
		writes: 0,
		/** Adds a key of that hash, as the real adapter would find it. */
		add(hash: string, key: StoredKey) {
			keys.set(hash, key);
		},
		/** The key of that id, or null. */
		byId(keyId: string): StoredKey | null {
			for (const key of keys.values()) if (key.id === keyId) return key;
			return null;
		},
		async find(hash: string) {
			twin.reads += 1;
			const found = keys.get(hash);
			return found ? { ...found } : null;
		},
		async idsOfDevice(deviceId: string) {
			twin.reads += 1;
			return [...keys.values()]
				.filter((key) => key.deviceId === deviceId)
				.map((key) => key.id);
		},
		async remove(keyId: string) {
			await twin.removeAll([keyId]);
		},
		async removeAll(keyIds: string[]) {
			twin.writes += 1;
			for (const [hash, key] of keys) {
				if (keyIds.includes(key.id)) keys.delete(hash);
			}
		},
		async setExpiry(keyId: string, at: number) {
			twin.writes += 1;
			const found = twin.byId(keyId);
			if (found) found.expiresAt = at;
		},
	};
	return twin satisfies KeyStore;
}

export type InMemoryKeyStore = ReturnType<typeof inMemoryKeyStore>;
