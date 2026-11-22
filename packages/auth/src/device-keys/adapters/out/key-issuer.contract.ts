import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { KeyIssuer } from "../../application/ports";
import type { StoredKey } from "../../domain/device-keys";

/** Two days (s): the plugin takes no key that expires in less than a day. */
const TWO_DAYS = 2 * 24 * 3600;

/** One adapter of `KeyIssuer` to test, with a Person to give keys to. */
export type KeyIssuerUnderTest = {
	keyIssuer: KeyIssuer;
	personId: string;
	/** The key as the Host keeps it, found by the key in the clear. */
	stored(key: string): Promise<StoredKey | null>;
	/** The adapter's time now (ms). */
	now(): number;
	close(): Promise<void>;
};

/**
 * What every adapter of `KeyIssuer` does. `key-issuer.contract.test.ts`
 * runs it on the in-memory adapter and on the real one.
 */
export function keyIssuerContract(
	name: string,
	make: () => Promise<KeyIssuerUnderTest>,
): void {
	describe(`KeyIssuer contract: ${name}`, () => {
		let under: KeyIssuerUnderTest;
		beforeEach(async () => {
			under = await make();
		});
		afterEach(async () => {
			await under.close();
		});

		test("a new key is a Device key of the Person, kept by its hash", async () => {
			const before = under.now();
			const made = await under.keyIssuer.create({
				personId: under.personId,
				name: "MacBook",
				deviceId: "device-b",
				permissions: { sync: ["pull", "push"], relay: ["serve"] },
				expiresIn: TWO_DAYS,
			});
			expect(made.key.startsWith("nsd_")).toBe(true);
			const stored = await under.stored(made.key);
			expect(stored).toMatchObject({
				id: made.keyId,
				personId: under.personId,
				deviceId: "device-b",
				permissions: { sync: ["pull", "push"], relay: ["serve"] },
			});
			expect(stored?.enabled).not.toBe(false);
			expect(stored?.expiresAt ?? 0).toBeGreaterThanOrEqual(
				before + TWO_DAYS * 1000 - 1_000,
			);
			expect(stored?.expiresAt ?? 0).toBeLessThanOrEqual(
				under.now() + TWO_DAYS * 1000 + 1_000,
			);
		});

		test("each key is its own", async () => {
			const key = {
				personId: under.personId,
				name: "MacBook",
				deviceId: "device-b",
				permissions: {},
				expiresIn: TWO_DAYS,
			};
			const first = await under.keyIssuer.create(key);
			const second = await under.keyIssuer.create(key);
			expect(second.key).not.toBe(first.key);
			expect(second.keyId).not.toBe(first.keyId);
		});
	});
}
