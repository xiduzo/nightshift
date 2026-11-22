import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { KeyStore } from "../../application/ports";
import type { StoredKey } from "../../domain/device-keys";

/** One adapter of `KeyStore` to test. */
export type KeyStoreUnderTest = {
	keyStore: KeyStore;
	/** Adds a key of that hash, as the adapter would find it. */
	add(hash: string, key: StoredKey): Promise<void>;
	close(): Promise<void>;
};

const B1: StoredKey = {
	id: "key-b1",
	personId: "ada",
	enabled: true,
	expiresAt: 1_000_000,
	permissions: { sync: ["pull", "push"] },
	deviceId: "device-b",
};
const B2: StoredKey = { ...B1, id: "key-b2", expiresAt: null };
const C1: StoredKey = { ...B1, id: "key-c1", deviceId: "device-c" };

/**
 * What every adapter of `KeyStore` does. `key-store.contract.test.ts` runs
 * it on the in-memory adapter and on the real one.
 */
export function keyStoreContract(
	name: string,
	make: () => Promise<KeyStoreUnderTest>,
): void {
	describe(`KeyStore contract: ${name}`, () => {
		let under: KeyStoreUnderTest;
		beforeEach(async () => {
			under = await make();
			await under.add("hash-b1", B1);
			await under.add("hash-b2", B2);
			await under.add("hash-c1", C1);
		});
		afterEach(async () => {
			await under.close();
		});

		test("finds a key by its hash, and nothing for another hash", async () => {
			expect(await under.keyStore.find("hash-b1")).toEqual(B1);
			expect(await under.keyStore.find("hash-b2")).toEqual(B2);
			expect(await under.keyStore.find("no-such-hash")).toBeNull();
		});

		test("lists the keys of a Device, and removes one or several", async () => {
			expect((await under.keyStore.idsOfDevice("device-b")).sort()).toEqual([
				"key-b1",
				"key-b2",
			]);
			await under.keyStore.remove("key-c1");
			expect(await under.keyStore.find("hash-c1")).toBeNull();
			await under.keyStore.removeAll(["key-b1", "key-b2"]);
			expect(await under.keyStore.idsOfDevice("device-b")).toEqual([]);
		});

		test("moves a key's expiry", async () => {
			await under.keyStore.setExpiry("key-b1", 2_000_000);
			expect((await under.keyStore.find("hash-b1"))?.expiresAt).toBe(2_000_000);
		});
	});
}
